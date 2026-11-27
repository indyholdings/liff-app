# Sidecar Agent — วิธีเปิดใช้งาน

Sidecar ทำงานคู่กับ LINE OA: แอดมินตอบแชทใน LINE OA Manager เหมือนเดิม
ส่วน Sidecar อ่านข้อความลูกค้า เติม lead card, โน้ต, อัลบั้ม และร่างออเดอร์ให้
แล้วแสดงใน panel ข้างแชท (Chrome extension) และหน้ามือถือ (`staff.html`)

- API: `https://ihbmufkwqgxzpyoepajz.supabase.co/functions/v1/sidecar`
- ข้อมูลอยู่ใน Supabase project `jaifu-one` (ref `ihbmufkwqgxzpyoepajz`) schema `sidecar` (แยกจากตารางเดิมทั้งหมด)
  project นี้ใช้ร่วมกับ JAIFU ONE, Hidden และ BaanNu ดู [supabase-map.md](supabase-map.md)
- Deploy v0.2 แล้ว (27 พ.ย. 2026): migration `sidecar_details` และ function `sidecar` version 2
- รายละเอียด route และโครงสร้างข้อมูล: [sidecar-contract.md](sidecar-contract.md)

## 1. ใส่ secret (ครั้งเดียว)

Supabase Dashboard → Edge Functions → Secrets

| ชื่อ | ค่า |
|---|---|
| `SIDECAR_LINE_CHANNEL_SECRET` | LINE Developers Console → Messaging API channel ของ OA ฝั่งขาย → Basic settings |
| `SIDECAR_LINE_CHANNEL_ACCESS_TOKEN` | channel เดียวกัน → Messaging API → Channel access token (long-lived) |
| `ANTHROPIC_API_KEY` | console.anthropic.com (ถ้า project มีอยู่แล้วใช้ตัวเดิมได้) |
| `SIDECAR_ADMIN_KEY` | ตั้งเองเป็นสตริงสุ่มยาว ๆ ใช้ออก token ให้พนักงาน |
| `SIDECAR_LIFF_CHANNEL_ID` (ไม่บังคับ) | LINE Login channel id ถ้าจะให้พนักงานเข้าหน้ามือถือด้วยบัญชี LINE |
| `SIDECAR_MODEL` (ไม่บังคับ) | ค่าเริ่มต้น `claude-opus-5-5`; ใส่ `claude-haiku-5-5` ถ้าต้องการลดต้นทุน |

**ห้ามแก้ `LINE_CHANNEL_SECRET` และ `LINE_CHANNEL_ACCESS_TOKEN` ที่มีอยู่เดิม** สองค่านั้นเป็นของ
function `line-webhook` / `line-send` (บัญชีแจ้งเตือนยอด JAIFU ONE) Sidecar ใช้ชื่อที่ขึ้นต้นด้วย `SIDECAR_` แยกต่างหาก

ตรวจผล: เปิด `<API>/health` ต้องได้ `"configured": true`

## 2. ต่อ LINE OA

1. LINE Developers Console → Messaging API → Webhook URL = `<API>/webhook` → Verify → เปิด Use webhook
2. LINE OA Manager → ตั้งค่า → การตอบกลับ: เปิดทั้ง **แชท** และ **Webhook**
   (สองอย่างนี้เปิดพร้อมกันได้ แอดมินยังตอบในแชทตามปกติ)

LINE channel หนึ่งตั้ง Webhook URL ได้ค่าเดียว **อย่าชี้ OA ที่ใช้ `line-webhook` อยู่ (บัญชีแจ้งเตือนยอด JAIFU ONE)
มาที่ Sidecar** เพราะระบบเชื่อมบัญชีด้วยรหัส 6 หลักและ "แจ้งโอน" จะหยุดทำงาน ให้ต่อ Sidecar กับ OA ฝั่งขายที่แอดมินคุยกับลูกค้า

## 3. ออก token ให้พนักงาน

```bash
curl -X POST <API>/api/admin/staff \
  -H "X-Admin-Key: <SIDECAR_ADMIN_KEY>" -H "Content-Type: application/json" \
  -d '{"name":"ริต้า","role":"admin"}'
```

token แสดงครั้งเดียว ระบบเก็บเฉพาะ hash พนักงานแต่ละคนควรมี token ของตัวเอง

## 4. ติดตั้ง panel บนคอมพิวเตอร์

1. Chrome → `chrome://extensions` → เปิด Developer mode → Load unpacked → เลือกโฟลเดอร์ `extension/`
2. คลิกไอคอน Sidecar → ตั้งค่า → ใส่ API URL และ token → ทดสอบการเชื่อมต่อ
3. เปิด `chat.line.biz` แล้วเลือกแชท panel จะขึ้นด้านขวา

## 5. หน้ามือถือ

เปิด `staff.html` (อยู่ที่เดียวกับเว็บนี้) ใส่ API URL และ token ครั้งแรกครั้งเดียว
ถ้าตั้ง `STAFF_LIFF_ID` ในไฟล์และ `SIDECAR_LIFF_CHANNEL_ID` ใน secret พนักงานผูกบัญชี LINE แล้วเข้าได้โดยไม่ต้องใส่ token อีก

## 6. ตั้งค่าร้าน

ใน panel หรือหน้ามือถือ → ตั้งค่า: ชื่อร้าน, ข้อความวิธีชำระเงิน (ใช้ในข้อความสรุปออเดอร์) และรายการสินค้า/ราคา

## สิ่งที่ต้องรู้

- Sidecar เห็นเฉพาะข้อความที่ลูกค้าส่งหลังต่อ webhook แล้ว แชทเก่าและข้อความที่แอดมินตอบจะไม่เข้าระบบ
- panel จับคู่แชทด้วยรหัสแชทใน URL ของ chat.line.biz ถ้าจับคู่ไม่ได้ panel จะให้เลือกลูกค้าแล้วกด "ผูกกับแชทนี้" ครั้งเดียว
- ตัวเลือก DOM ของ chat.line.biz อยู่ใน `SIDECAR_DOM` ต้นไฟล์ `extension/content.js` ยังไม่ได้ทดสอบกับหน้าจริง
  ถ้าปุ่ม "ใส่ในช่องแชท" หาช่องพิมพ์ไม่เจอ ระบบจะคัดลอกข้อความให้แทน
- การอ่านสลิปคือการอ่านตัวเลขจากรูป ไม่ใช่การยืนยันว่าเงินเข้า ออเดอร์จะเป็น "ชำระแล้ว" เมื่อแอดมินกดยืนยันเท่านั้น
- ระบบเก็บชื่อ เบอร์ ที่อยู่ ข้อความ และรูปของลูกค้า ควรแจ้งในนโยบายความเป็นส่วนตัวของร้านตาม PDPA

## สำหรับนักพัฒนา

```bash
npm install
npm test           # backend บน PGlite
npm run test:ui    # UI กับ mock API
npm run test:e2e   # UI จริงกับ backend จริง รวมจำลองข้อความ LINE
npm run dev        # API ที่ localhost:8787 พร้อมข้อมูลตัวอย่าง (token: dev-staff-token)
```
