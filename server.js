require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;
const BUCKET = process.env.SUPABASE_BUCKET || "product-images";

// ================= Checagem de ambiente =================
// Se faltar alguma variável, o servidor AINDA SOBE (pra você nunca ver a tela
// genérica de "Application error" do Render) — só que toda rota que depende do
// banco responde com uma mensagem clara dizendo exatamente o que falta.
// Verifique em /api/health a qualquer momento.
const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_USER", "ADMIN_PASSWORD"];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length) {
  console.error("\n[CONFIGURAÇÃO INCOMPLETA] Faltam estas variáveis de ambiente: " + missingEnv.join(", "));
  console.error("No Render: Settings → Environment → adicione essas variáveis e reinicie o serviço.");
  console.error("Confira em https://SUA-URL.onrender.com/api/health\n");
}

let supabase = null;
let supabaseInitError = null;
try {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  } else {
    supabaseInitError = "SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY não configurados.";
  }
} catch (e) {
  supabaseInitError = e.message;
  console.error("[ERRO] Falha ao criar o cliente do Supabase:", e.message);
}

// Toda rota que fala com o banco passa por aqui primeiro.
function requireDb(_req, res, next) {
  if (!supabase) return res.status(503).json({ error: "Servidor sem conexão com o banco: " + supabaseInitError });
  next();
}
function requireAuth(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.status(401).json({ error: "Não autorizado." });
}
// Log sempre no console (aparece no log do Render) + resposta clara pro navegador.
function fail(res, e, status) {
  console.error("[ERRO]", e && e.message ? e.message : e);
  res.status(status || 500).json({ error: (e && e.message) || "Erro no servidor." });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    cb(["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype) ? null : new Error("Use JPG, PNG, WEBP ou GIF."), true)
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: false, maxAge: 1000 * 60 * 60 * 8 }
  // Se for usar HTTPS (Render já fornece), pode trocar secure para true.
}));
app.use(express.static(__dirname + "/public"));

// ================= Diagnóstico =================
// Abra https://SUA-URL.onrender.com/api/health no navegador a qualquer momento
// pra ver o que está configurado e se o banco está respondendo.
app.get("/api/health", async (_req, res) => {
  const report = {
    ok: true,
    env: {
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_BUCKET: process.env.SUPABASE_BUCKET || "(usando padrão: product-images)",
      ADMIN_USER: !!process.env.ADMIN_USER,
      ADMIN_PASSWORD: !!process.env.ADMIN_PASSWORD,
      MASTER_RECOVERY_CODE: !!process.env.MASTER_RECOVERY_CODE,
      SESSION_SECRET: !!process.env.SESSION_SECRET
    },
    database: "não testado"
  };
  if (missingEnv.length) { report.ok = false; report.missingEnv = missingEnv; }
  if (!supabase) {
    report.ok = false;
    report.database = "sem cliente configurado: " + supabaseInitError;
    return res.json(report);
  }
  try {
    const { error } = await supabase.from("settings").select("id").limit(1);
    if (error) { report.ok = false; report.database = "erro ao consultar: " + error.message; }
    else report.database = "conectado";
  } catch (e) {
    report.ok = false;
    report.database = "falha de conexão: " + e.message;
  }
  res.json(report);
});

// ================= Helpers =================
async function getSettings() {
  let { data, error } = await supabase.from("settings").select("*").eq("id", 1).single();
  if (error) {
    // Linha de configurações não existe ainda (ex: schema.sql rodou sem o insert padrão).
    // Em vez de quebrar a loja inteira, cria a linha padrão automaticamente.
    const { data: created, error: insErr } = await supabase
      .from("settings")
      .insert({ id: 1, name: "DROP VENDAS", whatsapp: "", pix: "", category_notes: {} })
      .select().single();
    if (insErr) throw error; // se nem isso funcionar, aí sim propaga o erro original
    data = created;
  }
  return data;
}
async function getProducts(all = false) {
  let q = supabase.from("products").select("*").order("sort_order", { ascending: true });
  if (!all) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}
function publicImage(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}
async function removeStorage(path) {
  if (!path) return;
  try { await supabase.storage.from(BUCKET).remove([path]); } catch (_e) { /* ignora se já não existir */ }
}
function trackingToken() {
  return crypto.randomBytes(9).toString("base64url");
}
// O link curto "wa.me/message/CÓDIGO" (gerado pelo WhatsApp Business) NÃO aceita
// o parâmetro ?text= pra pré-preencher a mensagem. Só um link direto no formato
// "https://wa.me/55DDDNUMERO" aceita. Por isso só anexamos o texto quando o
// link configurado bate com esse formato — senão devolvemos o link puro, e o
// site copia a mensagem pra área de transferência como alternativa.
function directWhatsApp(base, msg) {
  const s = String(base || "").trim().replace(/\/+$/, "");
  return /wa\.me\/\d+$/i.test(s) ? s + "?text=" + encodeURIComponent(msg) : s;
}
function buildOrderMessage(productName, price, ffId, ffId2, trackingUrl) {
  const idsBlock = ffId2 ? `🎮 ID 1: ${ffId}\n🎮 ID 2: ${ffId2}` : `🎮 ID Free Fire: ${ffId}`;
  return `🛒 PEDIDO — DROP VENDAS\n\n📦 Produto: ${productName}\n💰 Valor: ${price}\n\n${idsBlock}\n\n` +
    `✅ Pagamento realizado via PIX.\n\n📎 COMPROVANTE:\nVou enviar o comprovante logo abaixo.\n\n` +
    `🟡 AGUARDANDO ENTREGA\n\n🔗 Acompanhar pedido: ${trackingUrl}`;
}

// ================= Autenticação =================
// A senha do admin fica sempre em hash na tabela admin_users — nunca em texto puro
// no JavaScript nem no banco. Na primeira vez que o servidor roda, se a tabela
// estiver vazia, ele cria o usuário usando ADMIN_USER / ADMIN_PASSWORD / MASTER_RECOVERY_CODE.
async function ensureAdminSeeded() {
  if (!supabase) { console.error("[AVISO] Pulei a criação do admin: banco não configurado."); return; }
  const { data, error } = await supabase.from("admin_users").select("id").limit(1);
  if (error) { console.error("Erro ao checar admin_users (verifique se rodou o supabase-schema.sql):", error.message); return; }
  if (data && data.length > 0) return;

  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASSWORD;
  const recovery = process.env.MASTER_RECOVERY_CODE;
  if (!user || !pass) {
    console.error("[ERRO] Defina ADMIN_USER e ADMIN_PASSWORD nas variáveis de ambiente antes de rodar pela primeira vez.");
    return;
  }
  const password_hash = bcrypt.hashSync(pass, 10);
  const recovery_code_hash = recovery ? bcrypt.hashSync(String(recovery), 10) : null;
  const { error: insErr } = await supabase.from("admin_users").insert({ username: user, password_hash, recovery_code_hash });
  if (insErr) console.error("Erro ao criar admin:", insErr.message);
  else console.log(`[OK] Usuário admin "${user}" criado.`);
}

app.post("/api/login", requireDb, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const { data: u, error } = await supabase.from("admin_users").select("*").eq("username", username || "").single();
    if (error || !u || !(await bcrypt.compare(String(password || ""), u.password_hash))) {
      return res.status(401).json({ error: "Usuário ou senha inválidos." });
    }
    req.session.admin = true;
    req.session.adminId = u.id;
    req.session.username = u.username;
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/admin/me", (req, res) => res.json({ authenticated: !!(req.session && req.session.admin), username: req.session ? req.session.username : null }));

// Trocar a senha do painel. Aceita dois caminhos:
// 1) informando a senha atual (currentPassword)
// 2) informando o código mestre de recuperação (recoveryCode), caso tenha esquecido a senha
app.post("/api/admin/change-password", requireDb, requireAuth, async (req, res) => {
  try {
    const { currentPassword, recoveryCode, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 4) {
      return res.status(400).json({ error: "A nova senha precisa ter pelo menos 4 caracteres." });
    }
    const { data: u, error } = await supabase.from("admin_users").select("*").eq("id", req.session.adminId).single();
    if (error || !u) return res.status(400).json({ error: "Usuário não encontrado." });

    let authorized = false;
    if (currentPassword && await bcrypt.compare(String(currentPassword), u.password_hash)) authorized = true;
    if (!authorized && recoveryCode && u.recovery_code_hash && await bcrypt.compare(String(recoveryCode), u.recovery_code_hash)) authorized = true;

    if (!authorized) return res.status(401).json({ error: "Senha atual ou código mestre incorretos." });

    const password_hash = bcrypt.hashSync(String(newPassword), 10);
    const { error: updErr } = await supabase.from("admin_users").update({ password_hash }).eq("id", u.id);
    if (updErr) throw updErr;
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

// ================= Loja (público) =================
app.get("/api/catalog", requireDb, async (_req, res) => {
  try {
    const [settings, rows] = await Promise.all([getSettings(), getProducts(false)]);
    const notes = settings.category_notes || {};
    const groups = {};
    rows.forEach(p => {
      if (!groups[p.category]) groups[p.category] = [];
      groups[p.category].push({
        id: p.id,
        name: p.name,
        desc: p.description,
        badge: p.badge,
        image: publicImage(p.image_url),
        variants: Array.isArray(p.variants) ? p.variants : []
      });
    });
    res.json({
      settings: { name: settings.name, whatsapp: settings.whatsapp, pix: settings.pix },
      categories: Object.entries(groups).map(([label, products]) => ({ label, note: notes[label] || "", products }))
    });
  } catch (e) { fail(res, e); }
});

// Cliente clica em "Já paguei, continuar": grava o pedido e devolve o link de
// acompanhamento + a mensagem pronta pro WhatsApp (a mensagem é montada aqui,
// no servidor, pra loja e painel nunca ficarem com textos diferentes).
// customer_whatsapp só é usado pelo painel — nunca é devolvido pela API pública.
app.post("/api/orders", requireDb, async (req, res) => {
  try {
    const { productName, price, ffId, ffId2, customerWhatsapp } = req.body || {};
    if (!productName || !price || !ffId) return res.status(400).json({ error: "Dados incompletos." });
    const dual = !!ffId2;
    const token = trackingToken();

    const { data, error } = await supabase.from("orders").insert({
      product_name: productName, price, ff_id: ffId, ff_id2: dual ? ffId2 : "",
      customer_whatsapp: customerWhatsapp || "",
      status: "Aguardando entrega", status1: "Aguardando entrega", status2: dual ? "Aguardando entrega" : "",
      tracking_token: token
    }).select().single();
    if (error) throw error;

    const settings = await getSettings();
    const trackingUrl = `${req.protocol}://${req.get("host")}/pedido/${token}`;
    const message = buildOrderMessage(productName, price, ffId, dual ? ffId2 : "", trackingUrl);
    const whatsappUrl = directWhatsApp(settings.whatsapp, message);

    res.json({ ok: true, orderId: data.id, trackingUrl, whatsappUrl, message });
  } catch (e) { fail(res, e); }
});

// Acompanhamento público do pedido (sem login) — usado pela página /pedido/:token.
// Não devolve o WhatsApp do cliente, só o necessário pra mostrar o status.
app.get("/api/pedido/:token", requireDb, async (req, res) => {
  try {
    const { data, error } = await supabase.from("orders")
      .select("id,product_name,price,ff_id,ff_id2,status1,status2,created_at")
      .eq("tracking_token", req.params.token).single();
    if (error || !data) return res.status(404).json({ error: "Pedido não encontrado." });
    res.json(data);
  } catch (e) { fail(res, e); }
});

// ================= Painel (protegido) =================
app.get("/api/admin/summary", requireDb, requireAuth, async (_req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: all, error } = await supabase.from("orders").select("price,status,status1,status2,ff_id,ff_id2,created_at");
    if (error) throw error;
    const toNum = (s) => { const n = parseFloat(String(s).replace(/[^\d,.-]/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
    const ordersToday = all.filter(o => (o.created_at || "").slice(0, 10) === today).length;
    const pending = all.filter(o => o.status1 === "Aguardando entrega" || o.status2 === "Aguardando entrega").length;
    // "Pago"/"Concluído" ficam aqui só por compatibilidade com pedidos antigos, de antes desta atualização.
    const confirmed = all.filter(o => ["Pago", "Enviado", "Concluído", "Pedido entregue"].includes(o.status));
    const salesToday = confirmed.filter(o => (o.created_at || "").slice(0, 10) === today).reduce((s, o) => s + toNum(o.price), 0);
    const salesConfirmedTotal = confirmed.reduce((s, o) => s + toNum(o.price), 0);
    const clients = new Set(all.flatMap(o => [o.ff_id, o.ff_id2].filter(Boolean))).size;
    res.json({ ordersToday, pending, salesToday, salesConfirmedTotal, clients });
  } catch (e) { fail(res, e); }
});

app.get("/api/admin/orders", requireDb, requireAuth, async (_req, res) => {
  try {
    const { data, error } = await supabase.from("orders").select("*").order("id", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) { fail(res, e); }
});

// Atualiza o status de entrega de um ID específico (1 ou 2). O status geral do
// pedido é recalculado sozinho a partir dos dois.
app.patch("/api/admin/orders/:id", requireDb, requireAuth, async (req, res) => {
  try {
    const STATUSES = ["Aguardando entrega", "Enviado", "Entregue"];
    const { data: o, error: oe } = await supabase.from("orders").select("*").eq("id", req.params.id).single();
    if (oe || !o) return res.status(404).json({ error: "Pedido não encontrado." });

    const status1 = STATUSES.includes(req.body.status1) ? req.body.status1 : o.status1;
    const status2 = o.ff_id2 ? (STATUSES.includes(req.body.status2) ? req.body.status2 : o.status2) : "";
    const overall = (status1 === "Entregue" && (!o.ff_id2 || status2 === "Entregue"))
      ? "Pedido entregue"
      : (status1 === "Enviado" || status2 === "Enviado") ? "Enviado" : "Aguardando entrega";

    const { data, error } = await supabase.from("orders").update({ status1, status2, status: overall }).eq("id", req.params.id).select().single();
    if (error) throw error;
    res.json({ ok: true, order: data });
  } catch (e) { fail(res, e); }
});

// Lista, em ordem de pedido, todos os IDs de "Reserva de Passe" — pensada pra
// você processar as reservas em lote, na ordem em que chegaram.
app.get("/api/admin/pass-reservations", requireDb, requireAuth, async (_req, res) => {
  try {
    const { data, error } = await supabase.from("orders")
      .select("*").ilike("product_name", "%reserva passe%").order("id", { ascending: true });
    if (error) throw error;
    const ids = [];
    data.forEach(o => { ids.push(o.ff_id); if (o.ff_id2) ids.push(o.ff_id2); });
    res.json({ orders: data, ids });
  } catch (e) { fail(res, e); }
});

app.get("/api/admin/customers", requireDb, requireAuth, async (_req, res) => {
  try {
    const { data, error } = await supabase.from("orders").select("ff_id,ff_id2,customer_whatsapp,created_at").order("created_at", { ascending: false });
    if (error) throw error;
    const map = new Map();
    data.forEach(o => {
      [o.ff_id, o.ff_id2].filter(Boolean).forEach(id => {
        if (!map.has(id)) map.set(id, { ffId: id, whatsapp: o.customer_whatsapp, orders: 0, lastOrder: o.created_at });
        map.get(id).orders++;
      });
    });
    res.json(Array.from(map.values()));
  } catch (e) { fail(res, e); }
});

app.get("/api/admin/products", requireDb, requireAuth, async (_req, res) => {
  try {
    const rows = await getProducts(true);
    // manda o caminho cru (pra reaproveitar no upload/edição) + a URL pública pronta pra exibir no painel
    res.json(rows.map(p => ({ ...p, image_public_url: publicImage(p.image_url) })));
  } catch (e) { fail(res, e); }
});

app.post("/api/admin/products", requireDb, requireAuth, upload.single("image"), async (req, res) => {
  try {
    const b = req.body;
    let image = "";
    if (req.file) {
      image = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${req.file.originalname.split(".").pop().toLowerCase()}`;
      const up = await supabase.storage.from(BUCKET).upload(image, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (up.error) throw up.error;
    }
    let variants;
    try { variants = JSON.parse(b.variants || "[]"); } catch (_e) { variants = []; }
    const row = {
      id: Date.now(), category: (b.category || "DIAMANTES").toUpperCase(), name: b.name || "Produto",
      description: b.desc || "", badge: b.badge || "", variants,
      image_url: image, active: b.active !== "false", sort_order: Number(b.sort_order || Date.now())
    };
    const { data, error } = await supabase.from("products").insert(row).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { fail(res, e, 400); }
});

app.put("/api/admin/products/:id", requireDb, requireAuth, upload.single("image"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { data: old, error: oe } = await supabase.from("products").select("*").eq("id", id).single();
    if (oe) throw oe;
    const b = req.body;
    let image = old.image_url || "";
    if (req.file) {
      image = `products/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${req.file.originalname.split(".").pop().toLowerCase()}`;
      const up = await supabase.storage.from(BUCKET).upload(image, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (up.error) throw up.error;
      await removeStorage(old.image_url);
    }
    let variants = old.variants;
    if (b.variants) { try { variants = JSON.parse(b.variants); } catch (_e) { /* mantém o valor antigo se vier inválido */ } }
    const patch = {
      category: b.category ? b.category.toUpperCase() : old.category, name: b.name || old.name,
      description: b.desc ?? old.description, badge: b.badge ?? old.badge,
      variants, image_url: image, active: b.active !== "false", sort_order: Number(b.sort_order || old.sort_order)
    };
    const { data, error } = await supabase.from("products").update(patch).eq("id", id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { fail(res, e, 400); }
});

app.delete("/api/admin/products/:id", requireDb, requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { data: p, error: pe } = await supabase.from("products").select("*").eq("id", id).single();
    if (pe) throw pe;
    await removeStorage(p.image_url);
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { fail(res, e, 400); }
});

app.get("/api/admin/settings", requireDb, requireAuth, async (_req, res) => {
  try { res.json(await getSettings()); } catch (e) { fail(res, e); }
});

app.put("/api/admin/settings", requireDb, requireAuth, async (req, res) => {
  try {
    const patch = { name: req.body.name || "DROP VENDAS", whatsapp: req.body.whatsapp || "", pix: req.body.pix || "" };
    if (req.body.category_notes) patch.category_notes = req.body.category_notes;
    const { data, error } = await supabase.from("settings").update(patch).eq("id", 1).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { fail(res, e, 400); }
});

app.get("/login", (_req, res) => res.sendFile(__dirname + "/public/login.html"));
app.get("/admin", (_req, res) => res.sendFile(__dirname + "/public/admin.html"));
app.get("/pedido/:token", (_req, res) => res.sendFile(__dirname + "/public/tracking.html"));

// Captura qualquer erro que escape das rotas acima (inclusive erros do multer,
// como arquivo de imagem grande demais ou em formato não aceito).
app.use((err, _req, res, _next) => {
  console.error("[ERRO não tratado]", err && err.message ? err.message : err);
  res.status(400).json({ error: (err && err.message) || "Erro no servidor." });
});

// Processos que não crasham o servidor por causa de um erro solto em alguma
// Promise — melhor logar e continuar de pé do que o Render reiniciar sem avisar.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

ensureAdminSeeded().finally(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`DROP VENDAS rodando na porta ${PORT}`);
    if (missingEnv.length) console.log(`Atenção: configuração incompleta. Veja /api/health para detalhes.`);
  });
});
