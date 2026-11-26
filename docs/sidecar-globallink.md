# Globallink Connect — Sidecar สำหรับ Globallink Estate

Sidecar ชุดเดียวกับของ JAIFU แต่เป็นอีก deployment หนึ่ง: ข้อมูลลูกค้า, secret, LINE OA และ Supabase project
แยกจากกันทั้งหมด ใช้โค้ดชุดเดียวกัน ต่างกันสองอย่าง

| | JAIFU | Globallink |
|---|---|---|
| Profile (`SIDECAR_PROFILE`) | `retail` | `real_estate` |
| Brand (ตอน build UI) | Sidecar (กลาง) | `globallink` — Forest / Coral / Ivory / Sage, Sarabun, โลโก้ทางการ |
| Model เริ่มต้น | `claude-opus-5-5` | `claude-haiku-5-5` (ตาม GBL Connect Blueprint) |

รายละเอียด profile และ brand: [sidecar-contract.md](sidecar-contract.md) หัวข้อ "Profiles and brands"

## สิ่งที่ profile อสังหาเปลี่ยน

- Stage: ใหม่ · รู้ความต้องการ · ส่งทรัพย์แล้ว · นัดดูทรัพย์ · รอมัดจำ · วางมัดจำแล้ว · ปิดดีล · หลุด · สแปม
- การ์ด "ความต้องการ": บทบาท, เรื่องที่ติดต่อ (ฝากขาย / ฝากเช่า / หาซื้อ / หาเช่า / แจ้งปัญหาหลังเช่า / One Stop Service),
  งบประมาณ, ทำเล/โครงการ, ประเภทห้อง, ต้องการย้ายเข้า, รหัสทรัพย์ — Agent เติมจากแชท แอดมินแก้ได้ และช่องที่แอดมินแก้จะถูกล็อก
- "สินค้า" เป็น "ทรัพย์", "ออเดอร์" เป็น "ข้อเสนอ/การจอง" พร้อมมัดจำ; สลิปเทียบกับยอดมัดจำหรือยอดรวม
- ร่างคำตอบของ Agent ไม่ระบุราคา ค่าธรรมเนียม ห้องว่าง หรือการคืนเงิน เว้นแต่ตัวเลขอยู่ในรายการทรัพย์ มิฉะนั้นจะเขียนว่าเจ้าหน้าที่จะยืนยัน
  และทุกข้อความยังส่งโดยคนเสมอ

## Build UI ของ Globallink

```bash
npm run build:brand globallink
```

ได้ `dist/globallink/extension/` (โหลดเข้า Chrome แบบ unpacked), `dist/globallink/globallink-extension.zip`
และ `dist/globallink/staff.html` พร้อมไฟล์ประกอบ สำหรับวางบน hosting ของ Globallink
โลโก้และสีมาจาก `brands/globallink/` ซึ่งคัดลอกจาก Globallink OS / GL CI

## Deploy (ยังไม่ได้ทำ)

ต้องมีก่อน: Supabase project ของ Globallink เอง (ไม่ใช้ `jaifu-one`) และ LINE OA ที่จะใช้จริง

1. Apply migration ทั้งหมดใน `supabase/migrations/` ตามลำดับ
2. Deploy function `sidecar` (ไฟล์ใน `supabase/functions/sidecar/`, ปิด verify JWT)
3. ตั้ง secret ตาม [sidecar-setup.md](sidecar-setup.md) และเพิ่ม `SIDECAR_PROFILE=real_estate`
4. ทำขั้นตอน LINE, token พนักงาน และตั้งค่าร้าน ตามคู่มือเดียวกัน โดยใช้ UI จาก `dist/globallink/`

## ใช้ร่วมกับบอทหลังการขายและ GBL Connect

LINE channel หนึ่งมี Webhook URL เดียว และ OA `@496zbssb` มีบอทหลังการขาย (Apps Script) ใช้อยู่ มีสองทางให้อยู่ร่วมกัน

- **Sidecar รับ webhook แล้วส่งต่อ:** ตั้ง `SIDECAR_FORWARD_WEBHOOK_URL` เป็น URL ของระบบเดิม Sidecar จะส่งทุก event
  ต่อไปแบบไม่แก้ไข และ Sidecar ไม่ใช้ reply token ระบบเดิมจึงยังตอบลูกค้าได้ตามปกติ
- **ระบบอื่นรับ webhook แล้วส่งต่อมาที่ Sidecar:** เช่น `line-webhook` ของ GBL Connect ส่ง body และ `x-line-signature`
  เดิมมาที่ `<API>/webhook` ไม่ต้องแก้โค้ด Sidecar

การส่งต่อทดสอบกับตัวรับจำลองแล้ว ยังไม่ได้ทดสอบกับ Apps Script จริง

GBL Connect (Blueprint v1.0, 26 พ.ย. 2026) วางตัวเองเป็นเจ้าของ webhook และระบบข้อมูลหลัก โดย Console ของทีมมีกำหนดใน Phase 1
Sidecar ทำหน้าที่ CRM pop-up ข้าง OA Manager ได้ตั้งแต่วันที่แอดมินยังตอบใน OA Manager
ข้อมูลของสองระบบยังไม่เชื่อมกัน: lead ใน Sidecar ไม่ใช่ `contact` / `lead` ของ GBL Connect การรวมเป็นระบบเดียวเป็นงานถัดไปที่ต้องตัดสินใจก่อน

## ทดสอบ

```bash
npm run test:ui:gbl    # UI ธีม Globallink กับ mock API
npm run test:e2e:gbl   # UI ธีม Globallink กับ backend จริงโหมด real_estate
npm run dev:gbl        # API ที่ localhost:8788 พร้อมข้อมูลตัวอย่างอสังหา (token: dev-staff-token)
```
