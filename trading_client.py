import os
import json
import logging
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)

DEFAULT_QMT_BASE_URL = os.getenv("QMT_HTTP_URL", "http://127.0.0.1:8085")
DEFAULT_API_KEY = os.getenv("QMT_API_KEY", "")

QMT_BUY_ORDER = 23
QMT_SELL_ORDER = 24
QMT_LIMIT_PRICE = 11


class QmtTradingClient:
    """HTTP client for the QMT gateway."""

    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None, timeout: int = 10):
        self.base_url = (base_url or os.getenv("QMT_HTTP_URL") or DEFAULT_QMT_BASE_URL).rstrip("/")
        self.api_key = api_key if api_key is not None else os.getenv("QMT_API_KEY", DEFAULT_API_KEY)
        self.timeout = timeout

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def health(self) -> Dict[str, Any]:
        response = requests.get(f"{self.base_url}/health", headers=self._headers(), timeout=self.timeout)
        try:
            payload = response.json()
        except ValueError:
            payload = {"raw": response.text}

        if response.status_code >= 400:
            raise RuntimeError(f"QMT gateway health check failed: HTTP {response.status_code} {payload}")
        return payload

    def _request(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        headers = self._headers()

        if method.upper() == "GET":
            response = requests.get(url, headers=headers, timeout=self.timeout)
        elif method.upper() == "POST":
            response = requests.post(url, headers=headers, json=payload or {}, timeout=self.timeout)
        else:
            raise ValueError(f"Unsupported HTTP method: {method}")

        try:
            body = response.json()
        except ValueError:
            body = {"raw": response.text}

        if response.status_code >= 400:
            raise RuntimeError(f"QMT gateway request failed: {method} {path} -> HTTP {response.status_code} {body}")
        return body

    def place_order(
        self,
        stock_code: str,
        side: str = "buy",
        volume: int = 100,
        price: float = 0.0,
        price_type: int = QMT_LIMIT_PRICE,
        order_type: Optional[int] = None,
        strategy_name: str = "stock_screener",
        order_remark: str = "",
        account_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        side = str(side).lower()
        if order_type is None:
            order_type = QMT_BUY_ORDER if side == "buy" else QMT_SELL_ORDER

        payload = {
            "stock_code": stock_code,
            "order_type": int(order_type),
            "order_volume": int(volume),
            "price_type": int(price_type),
            "price": float(price),
            "strategy_name": strategy_name,
            "order_remark": order_remark or f"{side}_order_from_stock_screener",
        }
        if account_id is not None:
            payload["account_id"] = account_id

        return self._request("POST", "/api/stock/order", payload)

    def cancel_order(self, order_id: int, account_id: Optional[str] = None) -> Dict[str, Any]:
        payload = {"order_id": int(order_id)}
        if account_id is not None:
            payload["account_id"] = account_id
        return self._request("POST", "/api/stock/cancel_order", payload)

    def get_positions(self) -> Dict[str, Any]:
        return self._request("GET", "/api/stock/positions")

    def get_orders(self) -> Dict[str, Any]:
        return self._request("GET", "/api/stock/orders")

    def get_trades(self) -> Dict[str, Any]:
        return self._request("GET", "/api/stock/trades")


qmt_client = QmtTradingClient()


__all__ = ["QmtTradingClient", "qmt_client", "QMT_BUY_ORDER", "QMT_SELL_ORDER", "QMT_LIMIT_PRICE"]
