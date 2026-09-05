// src/routes/report.js
const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { requireLogin } = require('../middleware/auth');
const { generateMonthlyReportPdf } = require('../services/report');

router.use(requireLogin);

function monthBounds(monthParam) {
  // monthParam like "2026-09"; defaults to current month
  const now = new Date();
  const [y, m] = (monthParam || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`).split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  const label = start.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return { start, end, label, monthParam: `${y}-${String(m).padStart(2, '0')}` };
}

async function computeReportData(monthParam) {
  const { start, end, label } = monthBounds(monthParam);

  const invoicesRaw = await prisma.invoice.findMany({
    where: { createdAt: { gte: start, lt: end } },
    include: { client: true },
    orderBy: { createdAt: 'asc' }
  });
  const invoices = invoicesRaw.map((i) => ({
    invoiceNumber: i.invoiceNumber,
    clientName: i.client.name,
    amountTTC: i.amountTTC,
    createdAt: i.createdAt
  }));
  const totalRevenue = invoices.reduce((sum, i) => sum + i.amountTTC, 0);

  const [shipped, late, problem, cancelled] = await Promise.all([
    prisma.event.count({ where: { type: 'order_shipped', createdAt: { gte: start, lt: end } } }),
    prisma.event.count({ where: { type: 'order_late', createdAt: { gte: start, lt: end } } }),
    prisma.event.count({ where: { type: 'order_problem', createdAt: { gte: start, lt: end } } }),
    prisma.event.count({ where: { type: 'order_cancelled', createdAt: { gte: start, lt: end } } })
  ]);

  return { label, invoices, totalRevenue, counts: { shipped, late, problem, cancelled } };
}

router.get('/report', async (req, res) => {
  const data = await computeReportData(req.query.month);
  const { monthParam } = monthBounds(req.query.month);
  res.render('report', { ...data, monthParam });
});

router.get('/report/download', async (req, res) => {
  const data = await computeReportData(req.query.month);
  const pdf = await generateMonthlyReportPdf(data);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Rapport_${req.query.month || 'mois-courant'}.pdf"`);
  res.send(pdf);
});

module.exports = router;
