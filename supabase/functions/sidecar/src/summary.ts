// The order summary staff paste into the chat. Built from the order by template,
// never by the model, so the lines and totals always match the order.

import type { Lead, Order, Settings } from "./types.ts";
import { formatMoney } from "./util.ts";

const PAYMENT_LABEL: Record<string, string> = {
  transfer: "โอนเงิน",
  cod: "เก็บเงินปลายทาง (COD)",
  installment: "ผ่อนชำระ",
};

export function buildOrderSummary(order: Order, lead: Lead, settings: Settings): string {
  const lines: string[] = [];
  lines.push(`สรุปรายการสั่งซื้อ${settings.shop_name ? ` ${settings.shop_name}` : ""}`);
  lines.push("");

  const name = lead.full_name || lead.display_name;
  if (name) lines.push(`ชื่อ: คุณ${name}`);
  if (lead.phone) lines.push(`เบอร์โทร: ${lead.phone}`);
  const address = [lead.address, lead.postcode].filter(Boolean).join(" ");
  if (address) lines.push(`ที่อยู่: ${address}`);
  if (name || lead.phone || address) lines.push("");

  lines.push("รายการ");
  order.items.forEach((it, i) => {
    lines.push(`${i + 1}. ${it.name} x${it.qty} = ${formatMoney(it.qty * it.unit_price)} บาท`);
  });
  lines.push("");

  const hasAdjustments = order.discount > 0 || order.shipping_fee > 0;
  if (hasAdjustments) lines.push(`ยอดรวมสินค้า: ${formatMoney(order.subtotal)} บาท`);
  if (order.discount > 0) lines.push(`ส่วนลด: -${formatMoney(order.discount)} บาท`);
  if (order.shipping_fee > 0) lines.push(`ค่าจัดส่ง: ${formatMoney(order.shipping_fee)} บาท`);
  lines.push(`ยอดสุทธิ: ${formatMoney(order.total)} บาท`);
  if (order.deposit_amount != null && order.deposit_amount > 0) {
    lines.push(`มัดจำ: ${formatMoney(order.deposit_amount)} บาท`);
    lines.push(`คงเหลือ: ${formatMoney(order.total - order.deposit_amount)} บาท`);
  }
  if (order.payment_method) lines.push(`ชำระโดย: ${PAYMENT_LABEL[order.payment_method]}`);
  if (order.note) lines.push(`หมายเหตุ: ${order.note}`);

  if (order.payment_method !== "cod" && settings.payment_instructions) {
    lines.push("");
    lines.push(settings.payment_instructions);
  }
  return lines.join("\n");
}
