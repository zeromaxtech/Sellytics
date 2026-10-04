from datetime import date


def build(shop_results: list) -> str:
    lines = [f"🛍️ Shop Digest — {date.today().isoformat()}", ""]

    if not shop_results:
        lines.append("No stores connected yet.")
        return "\n".join(lines)

    for result in shop_results:
        if "error" in result:
            lines.append(f"⚠️ {result['platform']}: {result['error']}")
            continue
        lines.append(f"🖨️ Printify — {result['shop_title']}")
        lines.append(f"   Recent orders fetched: {result['recent_order_count']}")
        if "orders_error" in result:
            lines.append(f"   ⚠️ Orders: {result['orders_error']}")

    return "\n".join(lines)
