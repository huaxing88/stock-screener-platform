"""缓存层：数据缓存读写、批量更新编排。

依赖 data_source.py 进行实际数据获取。
"""

import os
import time
import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional
from datetime import datetime, timedelta

import pandas as pd

from mock_data import generate_mock_stock_list, generate_mock_kline
from data_source import (
    _bypass_proxy,
    _check_stocklist_api,
    _detect_kline_source,
    _fetch_kline_with_retry,
    _normalize_columns,
    _filter_range,
    _normalize_date,
    _filter_stocks_by_market,
    _kline_source,
)

logger = logging.getLogger(__name__)

CACHE_DIR = os.path.join(os.path.dirname(__file__), "data_cache")
DATA_MODE = "auto"
DATA_START_DATE = "20210101"
STATUS_FILE = os.path.join(CACHE_DIR, "update_status.json")
TRADE_CAL_FILE = os.path.join(CACHE_DIR, "trade_calendar.pkl")

_stock_list_cache = None
_update_running = False
_update_progress = {
    "status": "idle", "current": 0, "total": 0,
    "code": "", "name": "", "message": "",
    "log": [], "success_count": 0, "error_count": 0,
}


def _ensure_cache_dir():
    os.makedirs(CACHE_DIR, exist_ok=True)


# ─── 股票列表 ────────────────────────────────────────────────────────

def get_stock_list() -> pd.DataFrame:
    """返回 DataFrame，列: code, name。"""
    global _stock_list_cache
    if _stock_list_cache is not None:
        return _stock_list_cache

    _ensure_cache_dir()
    cache_path = os.path.join(CACHE_DIR, "stock_list.pkl")

    if os.path.exists(cache_path):
        age = time.time() - os.path.getmtime(cache_path)
        if age < 86400:
            _stock_list_cache = pd.read_pickle(cache_path)
            logger.info(f"Loaded {len(_stock_list_cache)} stocks from cache")
            return _stock_list_cache

    if DATA_MODE != "mock" and _check_stocklist_api():
        try:
            import akshare as ak
            with _bypass_proxy():
                df = ak.stock_info_a_code_name()
            if list(df.columns) != ["code", "name"]:
                df.columns = ["code", "name"]
            df.to_pickle(cache_path)
            _stock_list_cache = df
            logger.info(f"Loaded {len(df)} stocks from AKShare")
            return df
        except Exception as e:
            logger.warning(f"Failed to fetch stock list: {e}")

    # 过期缓存回退
    if os.path.exists(cache_path):
        try:
            _stock_list_cache = pd.read_pickle(cache_path)
            logger.info(f"Loaded {len(_stock_list_cache)} stocks from expired cache")
            return _stock_list_cache
        except Exception:
            pass

    df = generate_mock_stock_list()
    df.to_pickle(cache_path)
    _stock_list_cache = df
    logger.info(f"Using mock stock list: {len(df)} stocks")
    return df


# ─── 历史 K 线数据 ──────────────────────────────────────────────────

def get_stock_hist(symbol: str, start_date: str, end_date: str,
                   adjust: str = "qfq", cache_only: bool = False) -> pd.DataFrame:
    _ensure_cache_dir()
    cache_path = os.path.join(CACHE_DIR, f"hist_{symbol}_{adjust}.pkl")

    if os.path.exists(cache_path):
        df = pd.read_pickle(cache_path)
        df = _normalize_columns(df)
        filtered = _filter_range(df, start_date, end_date)
        if not filtered.empty:
            return filtered

    if cache_only:
        return pd.DataFrame()

    if DATA_MODE == "mock":
        df = generate_mock_kline(symbol, start_date, end_date)
        if not df.empty:
            df.to_pickle(cache_path)
        return df

    if _detect_kline_source():
        try:
            df = _fetch_kline_with_retry(symbol, start_date, end_date, adjust)
            if df is not None and not df.empty:
                df = _normalize_columns(df)
                if os.path.exists(cache_path):
                    existing = pd.read_pickle(cache_path)
                    df = pd.concat([existing, df]).drop_duplicates(
                        subset=["date"]).sort_values("date").reset_index(drop=True)
                df.to_pickle(cache_path)
                return _filter_range(df, start_date, end_date)
        except Exception as e:
            logger.warning(f"K-line fetch failed for {symbol}: {e}")

    if os.path.exists(cache_path):
        df = _normalize_columns(pd.read_pickle(cache_path))
        filtered = _filter_range(df, start_date, end_date)
        if not filtered.empty:
            return filtered

    if _kline_source is None:
        df = generate_mock_kline(symbol, start_date, end_date)
        if not df.empty:
            df.to_pickle(cache_path)
        return df

    return pd.DataFrame()


# ─── 选股辅助 ────────────────────────────────────────────────────────

def get_screening_data(symbol, screen_date, lookback_days=400, forward_days=40,
                       cache_only: bool = False):
    screen_dt = datetime.strptime(screen_date.replace("-", ""), "%Y%m%d")
    start_dt = screen_dt - timedelta(days=lookback_days)
    end_dt = screen_dt + timedelta(days=forward_days)
    return get_stock_hist(
        symbol,
        start_dt.strftime("%Y%m%d"),
        end_dt.strftime("%Y%m%d"),
        cache_only=cache_only,
    )


def find_date_index(df, target_date):
    if df.empty:
        return -1
    target = _normalize_date(target_date)
    dates = df["date"].astype(str)
    matches = df.index[dates == target].tolist()
    if matches:
        return matches[0]
    prior = df[dates <= target]
    return prior.index[-1] if not prior.empty else -1


# ─── 交易日历 ────────────────────────────────────────────────────────

def _latest_trade_date_str() -> str:
    """返回最新 A 股交易日（YYYY-MM-DD）。"""
    _ensure_cache_dir()

    if os.path.exists(TRADE_CAL_FILE):
        age = time.time() - os.path.getmtime(TRADE_CAL_FILE)
        if age < 86400:
            try:
                tds = pd.read_pickle(TRADE_CAL_FILE)
                if tds is not None and len(tds) > 0:
                    return str(max(tds))
            except Exception:
                pass

    return (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d")


def _count_date_gaps(df: pd.DataFrame) -> int:
    """统计缓存日期序列中的缺失工作日数。"""
    if df is None or df.empty or "date" not in df.columns:
        return 0

    try:
        dates = pd.to_datetime(df["date"], errors="coerce").dropna().sort_values().unique()
        if len(dates) < 3:
            return 0

        prev = pd.Timestamp(dates[0])
        gap_days = 0
        for dt in dates[1:]:
            cur = pd.Timestamp(dt)
            bdays = len(pd.bdate_range(prev, cur))
            if bdays > 2:
                gap_days += (bdays - 2)
            prev = cur
        return int(gap_days)
    except Exception:
        return 0


# ─── 数据状态 ────────────────────────────────────────────────────────

def get_data_status():
    _ensure_cache_dir()
    stocks = get_stock_list()
    total_stocks = len(stocks)

    cached_count = 0
    up_to_date_count = 0
    fresh_count = 0
    missing_count = 0
    stale_count = 0
    gap_count = 0
    short_count = 0

    latest_date = None
    oldest_date = None
    latest_trade_date = _latest_trade_date_str()
    min_required_rows = 400

    for _, row in stocks.iterrows():
        cp = os.path.join(CACHE_DIR, f"hist_{row['code']}_qfq.pkl")
        if not os.path.exists(cp):
            missing_count += 1
            continue

        cached_count += 1
        try:
            df = pd.read_pickle(cp)
            if df is None or df.empty:
                missing_count += 1
                continue

            last = str(df["date"].iloc[-1])
            first = str(df["date"].iloc[0])

            if last >= latest_trade_date:
                up_to_date_count += 1
            else:
                stale_count += 1

            gap_days = _count_date_gaps(df)
            if gap_days > 0:
                gap_count += 1

            if len(df) < min_required_rows:
                short_count += 1

            if (last >= latest_trade_date) and gap_days == 0 and len(df) >= min_required_rows:
                fresh_count += 1

            if latest_date is None or last > latest_date:
                latest_date = last
            if oldest_date is None or first < oldest_date:
                oldest_date = first
        except Exception:
            missing_count += 1

    refill_p1 = stale_count
    refill_p2 = gap_count
    refill_p3 = max(0, missing_count + short_count)
    refill_required_count = max(0, missing_count + stale_count + gap_count + short_count)

    fresh_ratio = round((fresh_count / total_stocks) * 100, 1) if total_stocks else 0.0
    coverage_pct = round((cached_count / total_stocks) * 100, 1) if total_stocks else 0.0
    freshness_pct = round((up_to_date_count / total_stocks) * 100, 1) if total_stocks else 0.0

    last_update = None
    if os.path.exists(STATUS_FILE):
        try:
            with open(STATUS_FILE, "r") as f:
                last_update = json.load(f).get("last_update")
        except Exception:
            pass

    return {
        "total_stocks": total_stocks,
        "cached_stocks": cached_count,
        "up_to_date_stocks": up_to_date_count,
        "missing_stocks": missing_count,
        "stale_stocks": stale_count,
        "gap_stocks": gap_count,
        "short_stocks": short_count,
        "fresh_stocks": fresh_count,
        "refill_required_stocks": refill_required_count,
        "refill_priority": {
            "p1_delta": refill_p1,
            "p2_gap": refill_p2,
            "p3_history": refill_p3,
        },
        "latest_trade_date": latest_trade_date,
        "min_required_rows": min_required_rows,
        "coverage_pct": coverage_pct,
        "freshness_pct": freshness_pct,
        "fresh_ratio_pct": fresh_ratio,
        "data_start": oldest_date,
        "data_end": latest_date,
        "last_update": last_update,
        "is_updating": _update_running,
        "data_mode": DATA_MODE,
        "akshare_available": bool(_kline_source),
        "kline_source": _kline_source,
    }


# ─── 批量更新 ────────────────────────────────────────────────────────

def _save_update_status():
    _ensure_cache_dir()
    with open(STATUS_FILE, "w") as f:
        json.dump({"last_update": datetime.now().isoformat(timespec="seconds")}, f)


def get_update_progress():
    return dict(_update_progress)


def start_batch_update(market_filter: Optional[str] = None,
                       update_mode: str = "incremental",
                       max_workers: int = 4):
    global _update_running
    if _update_running:
        return {"success": False, "message": "Update already in progress"}
    workers = max(1, min(int(max_workers), 32))
    mode = update_mode if update_mode in {"incremental", "full"} else "incremental"
    t = threading.Thread(
        target=_run_batch_update,
        args=(market_filter, mode, workers),
        daemon=True,
    )
    t.start()
    return {
        "success": True,
        "message": "Update started",
        "market_filter": market_filter,
        "update_mode": mode,
        "max_workers": workers,
    }


def _read_existing_end(cache_path: str) -> Optional[str]:
    if not os.path.exists(cache_path):
        return None
    try:
        existing = pd.read_pickle(cache_path)
        if existing is not None and not existing.empty:
            return str(existing["date"].iloc[-1]).replace("-", "")
    except Exception:
        pass
    return None


def _update_one_stock(code: str, name: str, cache_path: str,
                      fetch_start: str, today_str: str, start_str: str,
                      existing_end: Optional[str]):
    if existing_end and existing_end >= today_str:
        return {
            "ok": True, "rows": None, "code": code, "name": name,
            "message": f"{code} {name} — 已是最新",
        }

    df = _fetch_kline_with_retry(
        code, fetch_start, today_str, "qfq",
        max_retries=3, base_delay=0.6,
    )

    rows = 0
    if df is not None and not df.empty:
        df = _normalize_columns(df)
        if os.path.exists(cache_path):
            try:
                old = pd.read_pickle(cache_path)
                if old is not None and not old.empty and "date" in old.columns and "date" in df.columns:
                    old_last = str(old["date"].iloc[-1])
                    new_dates = df["date"].astype(str)
                    if len(new_dates) > 0 and new_dates.iloc[0] > old_last:
                        df = pd.concat([old, df], ignore_index=True)
                    else:
                        df = pd.concat([old, df]).drop_duplicates(
                            subset=["date"]).sort_values("date").reset_index(drop=True)
                else:
                    df = pd.concat([old, df]).drop_duplicates(
                        subset=["date"]).sort_values("date").reset_index(drop=True)
            except Exception:
                pass
        df.to_pickle(cache_path)
        rows = len(df)

    return {
        "ok": True, "rows": rows, "code": code, "name": name,
        "message": f"{code} {name} — {rows} 条",
    }


def _run_batch_update(market_filter: Optional[str] = None,
                      update_mode: str = "incremental",
                      max_workers: int = 4):
    global _update_running, _update_progress, _stock_list_cache

    _update_running = True
    _update_progress = {
        "status": "running", "current": 0, "total": 0,
        "code": "", "name": "", "message": "检测数据源...",
        "log": [], "success_count": 0, "error_count": 0,
    }

    try:
        _stock_list_cache = None
        _update_progress["message"] = "获取股票列表..."
        _check_stocklist_api(force=True)

        _update_progress["message"] = "测试K线数据源..."
        source = _detect_kline_source(force=True)

        if source is None:
            _update_progress.update({
                "status": "error",
                "message": "所有K线数据源均不可用，请检查网络或关闭代理后重试",
            })
            _update_progress["log"].append("错误: 腾讯和东方财富K线接口均无法访问")
            _update_progress["log"].append("提示: 请关闭系统代理 (ClashX/Surge/V2Ray) 后重试")
            return

        source_label = "腾讯" if source == "tencent" else "东方财富"
        stocks = get_stock_list()
        stocks = _filter_stocks_by_market(stocks, market_filter)
        total_universe = len(stocks)
        today_str = datetime.now().strftime("%Y%m%d")
        start_str = DATA_START_DATE

        tasks = []
        already_latest = 0
        for _, row in stocks.iterrows():
            code = row["code"]
            name = row["name"]
            cache_path = os.path.join(CACHE_DIR, f"hist_{code}_qfq.pkl")
            existing_end = _read_existing_end(cache_path)
            fetch_start = existing_end if existing_end and existing_end >= start_str else start_str
            up_to_date = bool(existing_end and existing_end >= today_str)

            if update_mode == "incremental" and up_to_date:
                already_latest += 1
                continue

            tasks.append({
                "code": code, "name": name, "cache_path": cache_path,
                "existing_end": existing_end, "fetch_start": fetch_start,
            })

        total = len(tasks)
        mode_label = "智能补齐" if update_mode == "incremental" else "全量刷新"
        market_label = market_filter or "全部市场"

        _update_progress["total"] = total
        _update_progress["current"] = 0
        _update_progress["message"] = (
            f"开始更新: 待处理 {total} 只 (模式: {mode_label}, 范围: {market_label}, 数据源: {source_label})"
        )
        _update_progress["log"].append(
            f"数据源: {source_label}, 模式: {mode_label}, 范围: {market_label}, 待处理 {total} / 股票池 {total_universe}"
        )
        if update_mode == "incremental" and already_latest > 0:
            _update_progress["log"].append(f"已自动跳过最新股票: {already_latest} 只")

        if total == 0:
            _save_update_status()
            _update_progress.update({
                "status": "completed",
                "message": f"无需更新，全部已是最新 (共 {total_universe} 只)",
                "success_count": total_universe, "error_count": 0,
            })
            return

        success_count = 0
        error_count = 0

        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            future_map = {
                pool.submit(
                    _update_one_stock,
                    t["code"], t["name"], t["cache_path"],
                    t["fetch_start"], today_str, start_str, t["existing_end"],
                ): t
                for t in tasks
            }

            completed = 0
            for fut in as_completed(future_map):
                task = future_map[fut]
                completed += 1

                _update_progress.update({
                    "current": completed,
                    "code": task["code"],
                    "name": task["name"],
                })

                try:
                    result = fut.result()
                    success_count += 1
                    msg = result["message"]
                    _update_progress.update({
                        "message": msg,
                        "success_count": success_count + already_latest,
                        "error_count": error_count,
                    })
                    _update_progress["log"].append(msg)
                except Exception as e:
                    error_count += 1
                    err_short = str(e)[:80]
                    msg = f"{task['code']} {task['name']} — 失败: {err_short}"
                    _update_progress.update({
                        "message": msg,
                        "success_count": success_count + already_latest,
                        "error_count": error_count,
                    })
                    _update_progress["log"].append(msg)

        _save_update_status()
        _update_progress.update({
            "status": "completed" if error_count == 0 else "error",
            "message": f"更新完成: {success_count + already_latest} 成功, {error_count} 失败",
            "success_count": success_count + already_latest,
            "error_count": error_count,
        })

    except Exception as e:
        _update_progress.update({
            "status": "error",
            "message": f"更新失败: {str(e)}",
        })
    finally:
        _update_running = False
