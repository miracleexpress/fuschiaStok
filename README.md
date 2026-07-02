# Fuschia Stok Paneli

Fuschia / Etullen toptan perde işletmesi için Node.js + Express + PostgreSQL stok yönetim sistemi.

---

## İçindekiler

1. [Özellikler](#özellikler)
2. [Hızlı Başlangıç (Local)](#hızlı-başlangıç)
3. [Render.com Deploy](#rendercom-deploy)
4. [Ortam Değişkenleri](#ortam-değişkenleri)
5. [İlk Kurulum Sonrası](#ilk-kurulum-sonrası)
6. [Hareket Akışı](#hareket-akışı)
7. [Test Senaryoları](#test-senaryoları)
8. [Sorun Giderme](#sorun-giderme)

---

## Özellikler

- Rulo girişi: ürün kodu + lot/barkod (Jalpersan barkodu) + metre → **Regüle Depo**'ya girer
- Merkez Depoya Aktar: lot kodu okutularak regüle depodaki mal merkez depo rafına taşınır
- Kesim/Sarf: Satış, Fire, Değerlendirme (merkez veya değerlendirme rafından — regüle depodan kesim yapılamaz)
- Değerlendirme rafı stoğu kesim/satışta kullanılabilir
- Stok negatife düşme engelidir (concurrent lock koruması)
- Tüm raporlar CSV olarak indirilebilir
- Mobil-first tasarım: 52px butonlar, kart görünümü
- Admin / Depo rol ayrımı
- Health check: `/health` ve `/health/db`

---

## Hızlı Başlangıç

### Gereksinimler

- Node.js 18+
- PostgreSQL 14+

### Adımlar

```bash
# 1. Projeyi klonla
cd fuschia-stock-panel

# 2. Bağımlılıkları yükle
npm install

# 3. .env dosyasını oluştur
cp .env.example .env
# .env dosyasını düzenleyerek DATABASE_URL ve SESSION_SECRET gir

# 4. PostgreSQL'de veritabanını oluştur
# psql -U postgres -c "CREATE DATABASE fuschia_db;"

# 5. Veritabanını kur ve örnek verileri yükle
npm run db:seed

# 6. Uygulamayı başlat
npm run dev
# → http://localhost:3000
```

### Varsayılan kullanıcılar

| Kullanıcı | Şifre    | Rol   |
|-----------|----------|-------|
| admin     | admin123 | Admin |
| depo      | depo123  | Depo  |

**Hemen şifreleri değiştirin!**

---

## Render.com Deploy

### Ön Koşullar

- [render.com](https://render.com) hesabı
- GitHub/GitLab'a push edilmiş kod

### Adım Adım Kurulum (14 adım)

#### 1. GitHub'a push et

```bash
git init
git add .
git commit -m "ilk commit"
git remote add origin https://github.com/KULLANICI/fuschia-stock-panel.git
git push -u origin main
```

#### 2. Render'da PostgreSQL oluştur

- Render Dashboard → **New** → **PostgreSQL**
- Name: `fuschia-db`
- Database: `fuschia_stock`
- Plan: **Free**
- → **Create Database**

#### 3. Bağlantı bilgisini kaydet

- Oluşturulan DB → **Connect** sekmesi
- **Internal Database URL**'yi kopyala

#### 4. Web Service oluştur

- Render Dashboard → **New** → **Web Service**
- Repository: `fuschia-stock-panel` seç
- Branch: `main`

#### 5. Build & Start ayarları

| Alan          | Değer         |
|---------------|---------------|
| Build Command | `npm install` |
| Start Command | `npm start`   |
| Plan          | Free          |

#### 6. Environment Variables ekle

**Environment** sekmesinde:

| Key              | Value                                    |
|------------------|------------------------------------------|
| `NODE_ENV`       | `production`                             |
| `DATABASE_URL`   | (3. adımdaki Internal Database URL)      |
| `SESSION_SECRET` | (aşağıdaki komutla üret)                 |

```bash
# SESSION_SECRET üretmek için:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

#### 7. Deploy et

- → **Create Web Service**
- Build logunu izle (2-3 dk)
- "Your service is live" bildirimi gelince hazır

#### 8. Veritabanı şemasını kur

Render Web Service → **Shell** sekmesi:
```bash
node -e "const{Pool}=require('pg');const fs=require('fs');const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});pool.query(fs.readFileSync('./db/schema.sql','utf8')).then(()=>{console.log('Schema tamam');pool.end()}).catch(e=>{console.error(e.message);pool.end()})"
```

#### 9. Seed verilerini yükle

Aynı Shell'de:
```bash
node db/seed.js
```

**Çıktı:** `Veritabanı kurulumu tamamlandı.`

#### 10. Uygulamayı test et

```
https://fuschia-stock-panel-xxxx.onrender.com
```

admin / admin123 ile giriş yap.

#### 11. Health check kontrol et

```
GET https://[URL]/health     → {"ok":true,"service":"fuschia-stock-panel"}
GET https://[URL]/health/db  → {"ok":true,"db":"connected"}
```

#### 12. Şifreleri değiştir

Admin ile giriş → **Kullanıcılar** → admin ve depo için yeni şifre gir.

#### 13. (Opsiyonel) Render Blueprint

Repo kökünde `render.yaml` var. Render Dashboard → **Blueprints** → repo bağla → tek tıkla deploy.

#### 14. (Opsiyonel) Custom domain

Web Service → **Settings** → **Custom Domains**

---

## Ortam Değişkenleri

| Değişken         | Açıklama                            | Örnek                          |
|------------------|-------------------------------------|--------------------------------|
| `DATABASE_URL`   | PostgreSQL bağlantı adresi          | `postgresql://user:pw@host/db` |
| `SESSION_SECRET` | Oturum şifreleme anahtarı           | 64 karakter hex string         |
| `NODE_ENV`       | Ortam tipi                          | `production`                   |
| `PORT`           | Sunucu portu (Render kendisi atar)  | `3000`                         |

---

## İlk Kurulum Sonrası

1. Admin ile giriş
2. **Kullanıcılar** → admin ve depo şifrelerini değiştir
3. **Raflar** → Mevcut rafları kontrol et (10 regüle depo, 48 merkez depo, 6 değerlendirme, 2 sistem)
4. **Rulo Girişi** → İlk test rulosunu kaydet
5. **Kesim** → Test kesimi yap

---

## Hareket Akışı

### Depo akışı

```
Regüle Depo  →  Merkez Depo  →  (Kesim/Sarf: Satış / Fire / Değerlendirme)
  (roll_in)     (lot okutularak       (sadece Merkez veya Değerlendirme
                 "Merkez Depoya        rafından yapılabilir — Regüle
                 Aktar" ile)           depodan doğrudan kesim yapılamaz)
```

### Stok hareketi tiplerine göre muhasebe

```
movement_type   | meter | source_shelf | target_shelf
────────────────┼───────┼──────────────┼──────────────────
roll_in         |  +    | NULL         | Regüle depo rafı
regulation_out  |  -    | Regüle rafı  | NULL
central_in      |  +    | NULL         | Merkez depo rafı
evaluation_in   |  +    | Kaynak raf   | Değerlendirme rafı
sales_out       |  -    | Kaynak raf   | SATIŞ (sistem)
fire_out        |  -    | Kaynak raf   | FİRE (sistem)
evaluation_out  |  -    | Merkez raf   | Değerlendirme rafı
```

`regulation_out` + `central_in` birbirini götürür (transfer, net stok değişmez) — tıpkı `evaluation_out`/`evaluation_in` gibi.

### "Değerlendirme rafına al" işlemi

Bir lot ana raftan değerlendirme rafına alındığında iki hareket yazılır:

1. `evaluation_out`: -metre (kaynak = ana raf)
2. `evaluation_in`:  +metre (hedef = değerlendirme rafı)
3. `evaluation_pieces`: parça kaydı (status='available')

Bu yapı sayesinde değerlendirme rafındaki lotlar kesim formunda görünür.

### "Değerlendirme rafından sat/fire et" işlemi

1. Kesim formunda ürün gir → lot listesinde `[DEĞ.RAF]` etiketli seçenekler görünür
2. Değerlendirme rafındaki lotu seç → kesim bilgilerini gir
3. `sales_out` veya `fire_out` hareketi yazılır
4. İlgili `evaluation_pieces` kaydı `status='used'` yapılır

### Net stok hesabı

```
Kalan = SUM(tüm stock_movements.meter)
      = roll_in - sales_out - fire_out
     (evaluation_in ve evaluation_out birbirini götürür)
```

---

## Test Senaryoları

### Senaryo 1: Rulo Girişi ve Stok Kontrolü

**Adımlar:**
1. Admin ile giriş
2. Rulo Girişi → Raf: `1-A`, Ürün: `DT-04`, Lot: `JAL-2024-001`, Metre: `45.00`
3. Kaydet
4. Rulo Stok raporu → DT-04 / JAL-2024-001 / 1-A / kalan: **45.00 m**

**Beklenen:** Stok kayıt altına alınır.

---

### Senaryo 2: Satış Kesimi ve Stok Azalması

**Ön koşul:** Senaryo 1 tamamlanmış.

**Adımlar:**
1. Kesim → Çıkış Tipi: Satış
2. Ürün: `DT-04` → Lot: `JAL-2024-001 — 1-A (kalan: 45.00 m)` seç
3. Kesim: `230` cm, Adet: `10` → Hesaplanan: **23.00 m**
4. Kaydet
5. Rulo Stok → kalan: **22.00 m**

**Beklenen:** 45.00 - 23.00 = 22.00 m.

---

### Senaryo 3: Değerlendirme Rafına Alma ve Geri Kullanım

**Ön koşul:** DT-04 / JAL-2024-001 üzerinde en az 5m stok.

**Adımlar:**
1. Kesim → Çıkış Tipi: **Değerlendirme**
2. Ürün: `DT-04`, Lot: 1-A'daki lot, Kesim: `150` cm, Adet: `2` → 3.00 m
3. Değerlendirme Rafı: `D-1A` → Kaydet
4. Değerlendirme Stok → yeni parça, durum: **Mevcut**
5. Kesim → Ürün: `DT-04` gir → `JAL-2024-001 — D-1A [DEĞ.RAF] (kalan: 3.00 m)` görünür
6. D-1A lotunu seç, Çıkış Tipi: Satış, Kesim: `150` cm, Adet: `1` (1.50 m) → Kaydet
7. Değerlendirme Stok → parça durumu: **Kullanıldı**

**Beklenen:** Değerlendirme rafı stoğu kesim formunda görünür ve kullanılabilir.

---

### Senaryo 4: Stok Aşımı Engeli

**Adımlar:**
1. Kesim → Ürün ve lot seç (5 m kalan diyelim)
2. Kesim: `500` cm, Adet: `20` → Hesaplanan: 100.00 m
3. Hesap kutusu kırmızıya döner
4. "Kesimi Kaydet" butonu disabled kalır
5. Tarayıcı devtools ile buton enabled yapılsa bile sunucu `Yetersiz stok!` hatası verir

**Beklenen:** Stok aşımında kayıt yapılamaz — çift koruma (frontend + backend + DB lock).

---

### Senaryo 5: Aynı Lot Farklı Ürüne Atama Engeli

**Adımlar:**
1. Rulo Girişi → Ürün: `DT-04`, Lot: `JAL-PAYLASILAN`, Metre: 10 → Kaydet
2. Rulo Girişi → Ürün: `KF-01`, Lot: `JAL-PAYLASILAN` gir → alandan çık
3. Lot alanı altında kırmızı uyarı: "Bu lot DT-04 ürünüyle kayıtlıdır!"
4. Formu gönder → Sunucu reddeder

**Beklenen:** Bir lot barkodu yalnızca bir ürüne atanabilir.

---

## Sorun Giderme

### "connect ECONNREFUSED" (lokal)

PostgreSQL çalışmıyor. `pg_ctl start` veya servisi başlat.

### Render'da "role does not exist"

`DATABASE_URL`'in **Internal** URL olduğunu doğrula. Render panelinden Internal URL'yi kopyala.

### Şifreyi unuttum

Render Shell:
```bash
node -e "const bcrypt=require('bcrypt');bcrypt.hash('yenisifre',10).then(h=>console.log(h))"
# Çıkan hash'i kopyala, sonra:
# psql $DATABASE_URL -c "UPDATE users SET password_hash='HASH' WHERE username='admin';"
```

### Free tier yavaş ilk yükleme

Render Free tier 15dk hareketsizlikte uyur. İlk istek 30-60sn alabilir. Cron ile `/health`'e ping atılabilir.

### Mevcut DB'ye migration (evaluation_in eklemek için)

```bash
# Render Shell veya lokal psql:
psql $DATABASE_URL -f db/migrate_001.sql
```

### Mevcut DB'ye migration (Regüle Depo eklemek için)

```bash
# Render Shell veya lokal psql:
psql $DATABASE_URL -f db/migrate_002.sql
```

Bu migration'dan sonra **Raflar** sayfasından en az bir tane "Regüle Depo" tipinde raf eklemeniz gerekir — Rulo Girişi artık bu rafları listeler. Mevcut "main" tipi raflarınız aynı kalır, sadece arayüzde "Merkez Depo" olarak gösterilir.

---

## Veritabanı Komutları

```bash
npm run db:seed    # Tam kurulum — şema + seed (TÜM VERİLERİ SILER!)
npm run db:schema  # Sadece şema (TÜM VERİLERİ SILER!)
```

> Uyarı: Production'da çalıştırmadan önce yedek al.

---

## Mimari

```
fuschia-stock-panel/
├── server.js              # Express, route mount, health check
├── db/
│   ├── pool.js            # pg.Pool, SSL
│   ├── schema.sql         # Tablolar + view'lar
│   ├── seed.js            # Node.js seed (bcrypt)
│   ├── migrate_001.sql    # evaluation_in geçişi
│   └── migrate_002.sql    # Regüle Depo geçişi
├── middleware/
│   └── auth.js            # requireLogin, requireAdmin
├── routes/
│   ├── auth.js
│   ├── dashboard.js
│   ├── rollEntries.js
│   ├── regulationTransfer.js # Regüle → Merkez Depo transferi
│   ├── cuttingEntries.js  # evaluation_in hareketi burada yazılır
│   ├── reports.js
│   ├── exports.js         # CSV indirme
│   ├── api.js             # /api/lots, /api/lot-lookup, /api/lot-stock, /api/check-lot
│   ├── products.js
│   ├── shelves.js
│   └── users.js
├── utils/
│   └── calculations.js    # metre hesabı, getLotsByProductCode
├── views/                 # EJS şablonları
├── public/style.css
├── render.yaml
└── .env.example
```
