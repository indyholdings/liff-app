// The order summary staff paste into the chat. Built from the order by template,
// never by the model, so the lines and totals always match the order.

import type { Lead, Order, ProfileName, Settings } from "./types.ts";
import { formatMoney } from "./util.ts";

const PAYMENT_LABEL: Record<string, string> = {
  transfer: "โอนเงิน",
  cod: "เก็บเงินปลายทาง (COD)",
  installment: "ผ่อนชำระ",
};

// A property offer: the unit, its price, and the deposit that reserves it.
function buildPropertyOffer(order: Order, lead: Lead, settings: Settings): string {
  const blocks: string[][] = [];
  blocks.push([`สรุปรายละเอียดทรัพย์${settings.shop_name ? ` ${settings.shop_name}` : ""}`]);

  const who: string[] = [];
  const name = lead.full_name || lead.display_name;
  if (name) who.push(`ชื่อ: คุณ${name}`);
  if (lead.phone) who.push(`เบอร์โทร: ${lead.phone}`);
  blocks.push(who);

  blocks.push(["ทรัพย์", ...order.items.map((it, i) => {
    const price = it.qty === 1
      ? `${formatMoney(it.unit_price)} บาท`
      : `x${it.qty} = ${formatMoney(it.qty * it.unit_price)} บาท`;
    return `${i + 1}. ${it.name} — ${price}`;
  })]);

  const money: string[] = [];
  if (order.discount > 0) money.push(`ส่วนลด: -${formatMoney(order.discount)} บาท`);
  if (order.shipping_fee > 0) money.push(`ค่าใช้จ่ายอื่น: ${formatMoney(order.shipping_fee)} บาท`);
  if (order.items.length > 1 || order.discount > 0 || order.shipping_fee > 0) {
    money.push(`ยอดรวม: ${formatMoney(order.total)} บาท`);
  }
  if (order.deposit_amount != null && order.deposit_amount > 0) {
    money.push(`มัดจำ: ${formatMoney(order.deposit_amount)} บาท`);
    money.push(`คงเหลือ: ${formatMoney(order.total - order.deposit_amount)} บาท`);
  }
  if (order.note) money.push(`หมายเหตุ: ${order.note}`);
  blocks.push(money);

  if (settings.payment_instructions) blocks.push([settings.payment_instructions]);
  return blocks.filter((b) => b.length).map((b) => b.join("\n")).join("\n\n");
}

export function buildOrderSummary(order: Order, lead: Lead, settings: Settings, profile: ProfileName = "retail"): string {
  if (profile === "real_estate") return buildPropertyOffer(order, lead, settings);
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
