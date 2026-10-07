<!-- prettier-ignore -->
<div align="center">
<img src="./static/favicon.png" alt="" height="72" />

# لوحة تحكم واحة · Waha Admin

[العربية](#العربية) • [English](#english)

</div>

---

## العربية

لوحة تحكم عربية (RTL) لإدارة مكتبة فيديوهات يوتيوب: استيراد المحتوى، مراجعته، فحص صلاحيته، وتصديره — مع تخزين على Supabase ونشر على Cloudflare Pages.

### المزايا

- **استيراد من يوتيوب** — رابط فيديو أو قائمة تشغيل أو قناة؛ تُضاف العناصر الجديدة بحالة `pending`.
- **قائمة مراجعة** — تبويبات: بانتظار المراجعة، معتمدة، غير متاحة، الكل.
- **فحص الصلاحية** — يكشف المحذوف/غير المتاح، والخاص، وغير المسموح بتضمينه، مع تعطيل أو حذف جماعي.
- **إجراءات جماعية** — تحديد واعتماد/حذف/تغيير تصنيف عدة فيديوهات دفعة واحدة.
- **تراجع وسجل نشاط** — كل عملية قابلة للتراجع من الإشعار أو من سجل النشاط.
- **بحث وفلاتر وترتيب وتصدير** — بحث فوري، تصفية بالتصنيف، ترتيب بالتاريخ، وتصدير CSV/JSON.
- **واجهة داكنة RTL** بتصميم متجاوب تعمل حتى بدون JavaScript.

### التشغيل

```bash
npm install
cp .env.example .env    # ثم املأ القيم
npm run dev             # http://localhost:5173
```

أنشئ الجدول في Supabase:

```sql
create table if not exists videos (
  id         text primary key,
  title      text not null,
  thumbnail  text,
  category   text,
  status     text not null default 'pending',
  duration   text,
  created_at timestamptz not null default now()
);
```

### متغيرات البيئة

| المتغيّر | الوصف |
| --- | --- |
| `SUPABASE_URL` | رابط مشروع Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | مفتاح service-role (يتجاوز RLS). |
| `YOUTUBE_API_KEY` | مفتاح YouTube Data API v3. |

### النشر

على **Cloudflare Pages**: أمر البناء `npm run build` ومجلد الإخراج `.svelte-kit/cloudflare`. أضف المتغيرات الثلاثة كمتغيرات مشفّرة لبيئتي Production و Preview.

> [!IMPORTANT]
> مفتاح `SUPABASE_SERVICE_ROLE_KEY` يعمل من الخادم فقط ويتجاوز Row Level Security. لا تضعه في أي كود يعمل في المتصفح، وضع المصادقة أمام النشر قبل إتاحته للعامة.

---

## English

An Arabic-first RTL console for managing a YouTube video library: ingest, review, audit availability, and export — backed by Supabase and deployed on Cloudflare Pages.

### Features

- **YouTube ingestion** — paste a video, playlist, or channel URL; new rows land as `pending`.
- **Review queue** — tabs for pending, approved, unavailable, and all.
- **Availability audit** — detects deleted/unavailable, private, and not-embeddable videos, with bulk disable or delete.
- **Bulk actions** — select many rows and approve, delete, or re-categorize at once.
- **Undo & activity log** — every action is revertible from the toast or the activity drawer.
- **Search, sort & export** — instant search, category filter, date sorting, and CSV/JSON export.
- **Dark RTL UI** — responsive, and it works without JavaScript.

### Quick start

```bash
npm install
cp .env.example .env    # then fill in the values
npm run dev             # http://localhost:5173
```

Create the table in Supabase:

```sql
create table if not exists videos (
  id         text primary key,
  title      text not null,
  thumbnail  text,
  category   text,
  status     text not null default 'pending',
  duration   text,
  created_at timestamptz not null default now()
);
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Your Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (bypasses RLS). |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key. |

### Deploy

To **Cloudflare Pages**: build command `npm run build`, output directory `.svelte-kit/cloudflare`. Add the three variables as encrypted env vars for both Production and Preview.

> [!IMPORTANT]
> `SUPABASE_SERVICE_ROLE_KEY` is server-only and bypasses Row Level Security. Never import it into client code, and put authentication in front of the deployment before making it public.
