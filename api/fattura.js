// Funzione Vercel: legge la foto/PDF di una fattura con Claude e la confronta con l'ordine.
// La chiave API sta SOLO nelle impostazioni di Vercel (variabile ANTHROPIC_API_KEY), mai nell'app.
const FIREBASE_WEB_KEY = 'AIzaSyB8u_ISw0l47xyZ7m7IM5GW39xSMSyrFwE'; // chiave pubblica di Firebase (lista-teperino)
const ADMIN = ['ltepe69@gmail.com'];
const MODELLO = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

const handler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });
  try {
    const { idToken, file, mediaType, fornitore, ordine, catalogo } = req.body || {};
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Manca ANTHROPIC_API_KEY nelle impostazioni di Vercel' });
    if (!file || !mediaType) return res.status(400).json({ error: 'Nessun file ricevuto' });

    // solo l'admin può usarla: verifica il login Firebase
    const v = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_KEY}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }) });
    const vj = await v.json().catch(() => ({}));
    const email = (vj.users && vj.users[0] && vj.users[0].email || '').toLowerCase();
    if (!ADMIN.includes(email)) return res.status(403).json({ error: 'Non autorizzato' });

    const allegato = mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: file } };

    const istruzioni = `Sei il controllore acquisti di una pizzeria. Ti do la fattura (o bolla) del fornitore "${fornitore}" e l'ordine che era stato fatto.

ORDINE (articolo, quantità ordinata, nota sulle unità):
${(ordine || []).map(o => `- ${o.articolo}: ${o.ordinato}${o.nota ? ` (${o.nota})` : ''}`).join('\n') || '- (nessun ordine disponibile)'}

CATALOGO (articoli che compriamo da questo fornitore, con l'unità con cui li contiamo):
${(catalogo || []).map(o => `- ${o.articolo} [${o.unita}]${o.nota ? ` (${o.nota})` : ''}`).join('\n') || '- (nessuno)'}

1) Leggi la fattura: numero, data (formato YYYY-MM-DD), imponibile totale, imposta totale (IVA o IGIC), totale.
   Per ogni riga articolo: descrizione (come scritta), qta (numero), unita (KG se a peso, altrimenti come in fattura: PZ, CAJA, CT…),
   prezzo (prezzo unitario PRIMA dello sconto), sconto (percentuale, 0 se non c'è), totale (importo netto della riga, senza imposta),
   aliquota (percentuale dell'imposta della riga),
   articolo (nome ESATTO dell'articolo del CATALOGO a cui corrisponde la riga, "" se nessuno),
   prezzo_catalogo (prezzo NETTO dopo lo sconto, senza imposta, per UNA unità del catalogo; esempio: tina da 2,8 kg a 8,21 €/kg con sconto 10% = 20,69; 0 se non si può calcolare con sicurezza).
2) Confronta con l'ordine. Per ogni articolo ordinato scrivi cosa è arrivato, convertendo le unità con le note
   (esempio: 18,14 kg di mozzarella = circa 6,5 tine da 2,8 kg). esito: "ok" se corrisponde (tolleranza ±10% sui pesi),
   "in_eccesso", "in_meno", "mancante", oppure "diverso" se è arrivato un prodotto diverso da quello ordinato.
   Per le righe della fattura che non erano nell'ordine aggiungi un elemento con articolo = descrizione della fattura ed esito "non_ordinato".
3) avvisi: errori di calcolo, sconti insoliti, righe illeggibili (frasi brevi in italiano).

Rispondi SOLO con un JSON valido, senza testo prima o dopo, con questa forma:
{"numero":"","data":"YYYY-MM-DD","imponibile":0,"imposta":0,"totale":0,
 "righe":[{"descrizione":"","qta":0,"unita":"","prezzo":0,"sconto":0,"totale":0,"aliquota":0,"articolo":"","prezzo_catalogo":0}],
 "confronto":[{"articolo":"","ordinato":"","consegnato":"","esito":"ok","nota":""}],
 "avvisi":[]}`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODELLO, max_tokens: 8000, messages: [{ role: 'user', content: [allegato, { type: 'text', text: istruzioni }] }] })
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: 'Lettura non riuscita: ' + ((j.error && j.error.message) || r.status) });
    const testo = (j.content || []).map(b => b.text || '').join('');
    const a = testo.indexOf('{'), b = testo.lastIndexOf('}');
    if (a < 0 || b < a) return res.status(502).json({ error: 'Risposta non leggibile, riprova' });
    const fattura = JSON.parse(testo.slice(a, b + 1));
    return res.status(200).json({ fattura });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Errore' });
  }
};
module.exports = handler;
// fatture lunghe (PDF di più pagine): la lettura può richiedere fino a un minuto
module.exports.config = { maxDuration: 60 };
