const express = require('express');
const pool    = require('../db/pool');

const router = express.Router();

const UTF8_BOM = '﻿';

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function buildCSV(headers, rows) {
  const lines = [headers.map(escapeCSV).join(';')];
  rows.forEach(row => lines.push(row.map(escapeCSV).join(';')));
  return UTF8_BOM + lines.join('\r\n');
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('tr-TR');
}

function fmtMeter(v) {
  const n = parseFloat(v);
  return isNaN(n) ? '' : n.toFixed(2);
}

// GET /reports/rulo-stok.csv
router.get('/rulo-stok.csv', async (req, res) => {
  const { product_code, lot_barcode, shelf_code } = req.query;
  let sql = `
    SELECT p.product_code, p.name, sm.lot_barcode, sh.shelf_code, sh.shelf_type,
      SUM(CASE WHEN sm.meter > 0 THEN sm.meter      ELSE 0 END)::NUMERIC(12,2) AS total_in,
      SUM(CASE WHEN sm.meter < 0 THEN ABS(sm.meter) ELSE 0 END)::NUMERIC(12,2) AS total_out,
      SUM(sm.meter)::NUMERIC(12,2) AS remaining
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    JOIN shelves sh ON sh.id = CASE
      WHEN sm.movement_type IN ('roll_in','evaluation_in','central_in') THEN sm.target_shelf_id
      ELSE sm.source_shelf_id
    END
    WHERE sh.shelf_type IN ('regulation','main','evaluation')
  `;
  const params = [];
  if (product_code) { params.push(`%${product_code}%`); sql += ` AND p.product_code ILIKE $${params.length}`; }
  if (lot_barcode)  { params.push(`%${lot_barcode}%`);  sql += ` AND sm.lot_barcode ILIKE $${params.length}`; }
  if (shelf_code)   { params.push(`%${shelf_code}%`);   sql += ` AND sh.shelf_code ILIKE $${params.length}`; }
  sql += ` GROUP BY p.product_code, p.name, sm.lot_barcode, sh.shelf_code, sh.shelf_type
           HAVING SUM(sm.meter) > 0 ORDER BY p.product_code, sm.lot_barcode, sh.shelf_code`;
  try {
    const { rows } = await pool.query(sql, params);
    const csv = buildCSV(
      ['Ürün Kodu','Ürün Adı','Lot / Barkod','Raf','Raf Tipi','Giriş (m)','Çıkış (m)','Kalan (m)'],
      rows.map(r => [
        r.product_code, r.name || '', r.lot_barcode, r.shelf_code,
        r.shelf_type === 'evaluation' ? 'Değerlendirme' : r.shelf_type === 'regulation' ? 'Regüle Depo' : 'Merkez Depo',
        fmtMeter(r.total_in), fmtMeter(r.total_out), fmtMeter(r.remaining),
      ])
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="rulo-stok.csv"');
    res.send(csv);
  } catch (err) {
    console.error('CSV rulo-stok:', err);
    res.status(500).send('CSV oluşturulamadı.');
  }
});

// GET /reports/degerlendirme.csv
router.get('/degerlendirme.csv', async (req, res) => {
  const { product_code, lot_barcode, status } = req.query;
  let sql = `
    SELECT ep.entry_date, p.product_code, p.name, ep.lot_barcode,
           src.shelf_code AS source_shelf, evs.shelf_code AS eval_shelf,
           ep.cut_cm, ep.quantity, ep.total_meter, ep.status, ep.note
    FROM evaluation_pieces ep
    JOIN products p   ON p.id   = ep.product_id
    JOIN shelves  src ON src.id = ep.source_shelf_id
    JOIN shelves  evs ON evs.id = ep.evaluation_shelf_id
    WHERE 1=1
  `;
  const params = [];
  if (product_code) { params.push(`%${product_code}%`); sql += ` AND p.product_code ILIKE $${params.length}`; }
  if (lot_barcode)  { params.push(`%${lot_barcode}%`);  sql += ` AND ep.lot_barcode ILIKE $${params.length}`; }
  if (status)       { params.push(status);               sql += ` AND ep.status = $${params.length}`; }
  sql += ' ORDER BY ep.entry_date DESC, ep.id DESC';
  try {
    const { rows } = await pool.query(sql, params);
    const statusLabel = { available: 'Mevcut', used: 'Kullanıldı', cancelled: 'İptal' };
    const csv = buildCSV(
      ['Tarih','Ürün Kodu','Ürün Adı','Lot / Barkod','Kaynak Raf','Değer. Rafı','cm','Adet','Metre','Durum','Not'],
      rows.map(r => [
        fmtDate(r.entry_date), r.product_code, r.name || '', r.lot_barcode,
        r.source_shelf, r.eval_shelf, fmtMeter(r.cut_cm), r.quantity,
        fmtMeter(r.total_meter), statusLabel[r.status] || r.status, r.note || '',
      ])
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="degerlendirme.csv"');
    res.send(csv);
  } catch (err) {
    console.error('CSV degerlendirme:', err);
    res.status(500).send('CSV oluşturulamadı.');
  }
});

// GET /reports/fire.csv
router.get('/fire.csv', async (req, res) => {
  const { product_code, lot_barcode, date_from, date_to } = req.query;
  let sql = `
    SELECT ce.entry_date, p.product_code, p.name, ce.lot_barcode,
           s.shelf_code, ce.cut_cm, ce.quantity, ce.total_meter, ce.note
    FROM cutting_entries ce
    JOIN products p ON p.id = ce.product_id
    JOIN shelves  s ON s.id = ce.source_shelf_id
    WHERE ce.output_type = 'fire'
  `;
  const params = [];
  if (product_code) { params.push(`%${product_code}%`); sql += ` AND p.product_code ILIKE $${params.length}`; }
  if (lot_barcode)  { params.push(`%${lot_barcode}%`);  sql += ` AND ce.lot_barcode ILIKE $${params.length}`; }
  if (date_from)    { params.push(date_from);            sql += ` AND ce.entry_date >= $${params.length}`; }
  if (date_to)      { params.push(date_to);              sql += ` AND ce.entry_date <= $${params.length}`; }
  sql += ' ORDER BY ce.entry_date DESC, ce.id DESC';
  try {
    const { rows } = await pool.query(sql, params);
    const csv = buildCSV(
      ['Tarih','Ürün Kodu','Ürün Adı','Lot / Barkod','Raf','cm','Adet','Metre','Not'],
      rows.map(r => [
        fmtDate(r.entry_date), r.product_code, r.name || '', r.lot_barcode,
        r.shelf_code, fmtMeter(r.cut_cm), r.quantity, fmtMeter(r.total_meter), r.note || '',
      ])
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="fire-raporu.csv"');
    res.send(csv);
  } catch (err) {
    console.error('CSV fire:', err);
    res.status(500).send('CSV oluşturulamadı.');
  }
});

// GET /reports/satis.csv
router.get('/satis.csv', async (req, res) => {
  const { product_code, lot_barcode, date_from, date_to } = req.query;
  let sql = `
    SELECT ce.entry_date, p.product_code, p.name, ce.lot_barcode,
           s.shelf_code, ce.cut_cm, ce.quantity, ce.total_meter, ce.note
    FROM cutting_entries ce
    JOIN products p ON p.id = ce.product_id
    JOIN shelves  s ON s.id = ce.source_shelf_id
    WHERE ce.output_type = 'sales'
  `;
  const params = [];
  if (product_code) { params.push(`%${product_code}%`); sql += ` AND p.product_code ILIKE $${params.length}`; }
  if (lot_barcode)  { params.push(`%${lot_barcode}%`);  sql += ` AND ce.lot_barcode ILIKE $${params.length}`; }
  if (date_from)    { params.push(date_from);            sql += ` AND ce.entry_date >= $${params.length}`; }
  if (date_to)      { params.push(date_to);              sql += ` AND ce.entry_date <= $${params.length}`; }
  sql += ' ORDER BY ce.entry_date DESC, ce.id DESC';
  try {
    const { rows } = await pool.query(sql, params);
    const csv = buildCSV(
      ['Tarih','Ürün Kodu','Ürün Adı','Lot / Barkod','Raf','cm','Adet','Metre','Not'],
      rows.map(r => [
        fmtDate(r.entry_date), r.product_code, r.name || '', r.lot_barcode,
        r.shelf_code, fmtMeter(r.cut_cm), r.quantity, fmtMeter(r.total_meter), r.note || '',
      ])
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="satis-raporu.csv"');
    res.send(csv);
  } catch (err) {
    console.error('CSV satis:', err);
    res.status(500).send('CSV oluşturulamadı.');
  }
});

// GET /reports/hareketler.csv
router.get('/hareketler.csv', async (req, res) => {
  const { product_code, lot_barcode, movement_type, date_from, date_to } = req.query;
  let sql = `
    SELECT sm.movement_date, sm.movement_type, p.product_code, p.name,
           sm.lot_barcode, src.shelf_code AS source_shelf, tgt.shelf_code AS target_shelf,
           sm.cut_cm, sm.quantity, sm.meter, sm.note, u.username AS created_by
    FROM stock_movements sm
    JOIN products p    ON p.id   = sm.product_id
    LEFT JOIN shelves src ON src.id = sm.source_shelf_id
    LEFT JOIN shelves tgt ON tgt.id = sm.target_shelf_id
    JOIN users    u    ON u.id   = sm.created_by
    WHERE 1=1
  `;
  const params = [];
  if (product_code)  { params.push(`%${product_code}%`);  sql += ` AND p.product_code ILIKE $${params.length}`; }
  if (lot_barcode)   { params.push(`%${lot_barcode}%`);   sql += ` AND sm.lot_barcode ILIKE $${params.length}`; }
  if (movement_type) { params.push(movement_type);         sql += ` AND sm.movement_type = $${params.length}`; }
  if (date_from)     { params.push(date_from);             sql += ` AND sm.movement_date >= $${params.length}`; }
  if (date_to)       { params.push(date_to);               sql += ` AND sm.movement_date <= $${params.length}`; }
  sql += ' ORDER BY sm.movement_date DESC, sm.id DESC';
  const typeLabel = {
    roll_in: 'Rulo Girişi (Regüle)', sales_out: 'Satış', fire_out: 'Fire',
    evaluation_out: 'Değer. Çıkış', evaluation_in: 'Değer. Giriş',
    regulation_out: 'Regüle Çıkış', central_in: 'Merkez Depo Girişi',
  };
  try {
    const { rows } = await pool.query(sql, params);
    const csv = buildCSV(
      ['Tarih','Hareket Tipi','Ürün Kodu','Ürün Adı','Lot / Barkod','Kaynak Raf','Hedef Raf','cm','Adet','Metre','Not','Kaydeden'],
      rows.map(r => [
        fmtDate(r.movement_date), typeLabel[r.movement_type] || r.movement_type,
        r.product_code, r.name || '', r.lot_barcode,
        r.source_shelf || '', r.target_shelf || '',
        r.cut_cm ? fmtMeter(r.cut_cm) : '', r.quantity || '',
        fmtMeter(r.meter), r.note || '', r.created_by,
      ])
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="hareketler.csv"');
    res.send(csv);
  } catch (err) {
    console.error('CSV hareketler:', err);
    res.status(500).send('CSV oluşturulamadı.');
  }
});

module.exports = router;
