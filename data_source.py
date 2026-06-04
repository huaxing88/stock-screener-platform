"""数据源层：AKShare 数据获取、重试、列名归一化。

不含缓存逻辑，纯数据获取函数。
"""

import os
import time
import logging
from typing import Optional

import pandas as pd

logger = logging.getLogger(__name__)

_stocklist_api_available = None
_kline_source = None  # "tencent", "eastmoney", or None


# ─── 代理绕过 ────────────────────────────────────────────────────────

_PROXY_ENV_KEYS = [
    "HTTP_PROXY", "http_proxy",
    "HTTPS_PROXY", "https_proxy",
    "ALL_PROXY", "all_proxy",
]

from contextlib import contextmanager


@contextmanager
def _bypass_proxy():
    """临时移除代理环境变量并 patch requests。"""
    saved = {}
    for key in _PROXY_ENV_KEYS:
        if key in os.environ:
            saved[key] = os.environ.pop(key)
    try:
        try:
            import requests
            orig_get = requests.Session.get
            orig_post = requests.Session.post

            def _patched_get(self, url, **kwargs):
                kwargs.setdefault("proxies", {"http": None, "https": None})
                return orig_get(self, url, **kwargs)

            def _patched_post(self, url, **kwargs):
                kwargs.setdefault("proxies", {"http": None, "https": None})
                return orig_post(self, url, **kwargs)

            requests.Session.get = _patched_get
            requests.Session.post = _patched_post
        except ImportError:
            orig_get = orig_post = None

        yield
    finally:
        for key, val in saved.items():
            os.environ[key] = val
        try:
            import requests
            if orig_get:
                requests.Session.get = orig_get
            if orig_post:
                requests.Session.post = orig_post
        except ImportError:
            pass


# ─── 代码转换 ────────────────────────────────────────────────────────

def _code_to_tx(code: str) -> str:
    """将纯代码 '000001' 转为腾讯格式 'sz000001'。"""
    if code.startswith(("sh", "sz")):
        return code
    if code.startswith("6"):
        return f"sh{code}"
    return f"sz{code}"


def _match_market(code: str, market_filter: Optional[str]) -> bool:
    """按板块匹配股票代码。"""
    if not market_filter:
        return True
    if market_filter == "主板":
        return (
            code.startswith("60")
            or code.startswith("000")
            or code.startswith("001")
            or code.startswith("002")
            or code.startswith("003")
        )
    if market_filter == "创业板":
        return code.startswith("300")
    if market_filter == "科创板":
        return code.startswith("688")
    return True


def _filter_stocks_by_market(stocks: pd.DataFrame, market_filter: Optional[str]) -> pd.DataFrame:
    if not market_filter:
        return stocks
    if "code" not in stocks.columns:
        return stocks
    return stocks[stocks["code"].astype(str).apply(lambda c: _match_market(c, market_filter))].reset_index(drop=True)


# ─── 数据源探测 ──────────────────────────────────────────────────────

def _check_stocklist_api(force: bool = False) -> bool:
    global _stocklist_api_available
    if not force and _stocklist_api_available is not None:
        return _stocklist_api_available
    try:
        import akshare as ak
        with _bypass_proxy():
            df = ak.stock_info_a_code_name()
            if df is not None and len(df) >= 100:
                _stocklist_api_available = True
                logger.info(f"Stock list OK: {len(df)} stocks")
            else:
                _stocklist_api_available = False
    except Exception as e:
        logger.warning(f"Stock list API unavailable: {e}")
        _stocklist_api_available = False
    return _stocklist_api_available


def _detect_kline_source(force: bool = False):
    """探测可用的 K 线数据源。返回 'tencent', 'eastmoney', 或 None。"""
    global _kline_source
    if not force and _kline_source is not None:
        return _kline_source

    import akshare as ak

    # 优先腾讯（更稳定）
    try:
        with _bypass_proxy():
            df = ak.stock_zh_a_hist_tx(
                symbol="sz000001", start_date="20240101",
                end_date="20240110", adjust="qfq",
            )
        if df is not None and len(df) > 0:
            _kline_source = "tencent"
            logger.info("K-line source: Tencent")
            return _kline_source
    except Exception as e:
        logger.debug(f"Tencent K-line test failed: {e}")

    # 回退东方财富
    try:
        with _bypass_proxy():
            df = ak.stock_zh_a_hist(
                symbol="000001", period="daily",
                start_date="20240101", end_date="20240110",
                adjust="qfq",
            )
        if df is not None and len(df) > 0:
            _kline_source = "eastmoney"
            logger.info("K-line source: East Money")
            return _kline_source
    except Exception as e:
        logger.debug(f"East Money K-line test failed: {e}")

    _kline_source = None
    logger.warning("No K-line data source available")
    return None


# ─── K 线获取（含重试 + 双源切换）────────────────────────────────────

def _fetch_kline_raw(symbol: str, start_date: str, end_date: str,
                     adjust: str = "qfq", source: str = "tencent") -> pd.DataFrame:
    """从指定数据源获取原始 K 线。"""
    import akshare as ak
    with _bypass_proxy():
        if source == "tencent":
            tx_sym = _code_to_tx(symbol)
            df = ak.stock_zh_a_hist_tx(
                symbol=tx_sym, start_date=start_date,
                end_date=end_date, adjust=adjust,
            )
        else:
            df = ak.stock_zh_a_hist(
                symbol=symbol, period="daily",
                start_date=start_date, end_date=end_date,
                adjust=adjust,
            )
    return df


def _fetch_kline_with_retry(symbol, start_date, end_date, adjust="qfq",
                            max_retries=3, base_delay=0.6):
    """带重试的 K 线获取，主源失败自动切换备用源。"""
    source = _kline_source or "tencent"
    alt_source = "eastmoney" if source == "tencent" else "tencent"

    last_err = None
    for attempt in range(max_retries):
        try:
            return _fetch_kline_raw(symbol, start_date, end_date, adjust, source)
        except Exception as e:
            last_err = e
            if attempt < max_retries - 1:
                delay = base_delay * (2 ** attempt)
                logger.debug(f"Retry {attempt+1}/{max_retries} {symbol} ({source}) in {delay}s")
                time.sleep(delay)

    # 主源耗尽，尝试备用源
    try:
        logger.debug(f"Trying alt source {alt_source} for {symbol}")
        return _fetch_kline_raw(symbol, start_date, end_date, adjust, alt_source)
    except Exception:
        pass

    raise last_err


# ─── 列名归一化 ──────────────────────────────────────────────────────

_EM_COLUMN_MAP = {
    "日期": "date", "股票代码": "code",
    "开盘": "open", "收盘": "close",
    "最高": "high", "最低": "low",
    "成交量": "volume", "成交额": "amount",
    "振幅": "amplitude", "涨跌幅": "pct_change",
    "涨跌额": "change", "换手率": "turnover",
}


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """将不同数据源的列名统一为标准英文名。"""
    if "日期" in df.columns:
        df = df.rename(columns=_EM_COLUMN_MAP)

    if "amount" in df.columns and "volume" not in df.columns:
        df = df.rename(columns={"amount": "volume"})

    if "amount" not in df.columns:
        df["amount"] = 0.0
    if "volume" not in df.columns:
        df["volume"] = 0.0

    if "date" in df.columns:
        try:
            df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.strftime("%Y-%m-%d")
        except Exception:
            pass

    if "pct_change" not in df.columns and "close" in df.columns:
        close = df["close"].astype(float)
        df["pct_change"] = close.pct_change() * 100
        df["pct_change"] = df["pct_change"].round(2)

    return df


# ─── 日期工具 ────────────────────────────────────────────────────────

def _filter_range(df: pd.DataFrame, start_date: str, end_date: str) -> pd.DataFrame:
    if df.empty:
        return df
    start = _normalize_date(start_date)
    end = _normalize_date(end_date)
    dates = df["date"].astype(str)
    return df[(dates >= start) & (dates <= end)].reset_index(drop=True)


def _normalize_date(date_str: str) -> str:
    if len(date_str) == 8 and "-" not in date_str:
        return f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
    return date_str
