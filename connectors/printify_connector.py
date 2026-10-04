"""Talks to Printify using a token the SHOP OWNER generated themselves
(Printify dashboard > My Account > Connections > Generate API token).
We never ask for or see their Printify password."""
import requests

BASE_URL = "https://api.printify.com/v1"


def get_shops(token: str) -> list:
    resp = requests.get(
        f"{BASE_URL}/shops.json",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def get_recent_orders(token: str, shop_id: str, limit: int = 10) -> list:
    resp = requests.get(
        f"{BASE_URL}/shops/{shop_id}/orders.json",
        headers={"Authorization": f"Bearer {token}"},
        params={"limit": limit},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json().get("data", [])


def collect(token: str) -> dict:
    """Returns a summary dict, or an 'error' key if the token is invalid."""
    try:
        shops = get_shops(token)
    except requests.HTTPError as e:
        return {"error": f"Could not reach Printify — check the token. ({e})"}

    if not shops:
        return {"error": "Token is valid but no shops are connected to it."}

    shop = shops[0]  # first shop for this simple version
    try:
        orders = get_recent_orders(token, shop["id"])
    except requests.HTTPError as e:
        orders = []
        order_error = str(e)
    else:
        order_error = None

    result = {
        "shop_title": shop.get("title"),
        "shop_id": shop.get("id"),
        "recent_order_count": len(orders),
    }
    if order_error:
        result["orders_error"] = order_error
    return result
