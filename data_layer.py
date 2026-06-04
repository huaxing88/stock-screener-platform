"""数据层兼容入口 — 统一 re-export，保持 app.py import 不变。

实际逻辑已拆分到：
  - data_source.py  数据源获取、重试、列名归一化
  - cache.py        缓存读写、批量更新编排
"""

from cache import (
    CACHE_DIR,
    DATA_MODE,
    DATA_START_DATE,
    get_stock_list,
    get_stock_hist,
    get_screening_data,
    find_date_index,
    get_data_status,
    start_batch_update,
    get_update_progress,
)

from data_source import (
    _bypass_proxy,
    _code_to_tx,
    _match_market,
    _filter_stocks_by_market,
    _check_stocklist_api,
    _detect_kline_source,
    _fetch_kline_raw,
    _fetch_kline_with_retry,
    _normalize_columns,
    _filter_range,
    _normalize_date,
)
