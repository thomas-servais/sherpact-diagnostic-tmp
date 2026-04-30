const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return;

  try {
    const { linkedin_url, email, jobId } = JSON.parse(event.body);
    if (!jobId) throw new Error('Missing jobId');

    // 1. RapidAPI scrape
    const rapidResp = await fetch(
      `https://fresh-linkedin-profile-data.p.rapidapi.com/enrich-lead?linkedin_url=${encodeURIComponent(linkedin_url)}&include_skills=false&include_certifications=false&include_profile_status=false&include_company_public_url=false`,
      {
        method: 'GET',
        headers: {
          'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
          'X-RapidAPI-Host': 'fresh-linkedin-profile-data.p.rapidapi.com'
        }
      }
    );

    if (!rapidResp.ok) throw new Error(`RapidAPI: ${rapidResp.status}`);
    const rapidData = await rapidResp.json();
    const p = rapidData.data || {};

    const profileText = [
      `Nom: ${p.full_name || ''}`,
      `Titre: ${p.headline || ''}`,
      `Poste: ${p.job_title || ''}`,
      `Entreprise: ${p.company || ''}`,
      `Localisation: ${p.hq_city || ''}, ${p.country || ''}`,
      `Abonnés: ${p.follower_count || ''}`,
      `École: ${p.school || ''}`,
      `Secteur: ${p.company_industry || ''}`,
      `Taille entreprise: ${p.company_employee_range || ''}`,
      `About: ${(p.about || '').replace(/[\n\r\t]/g, ' ').substring(0, 1500)}`
    ].join('\n');

    // 2. Claude analyse
    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: `Tu es un expert en personal branding LinkedIn. Analyse ce profil en mode recherche emploi avec un ton direct, bienveillant et vouvoiement détendu. Reponds UNIQUEMENT avec un JSON brut valide, sans backticks ni markdown.

Profil LinkedIn:
${profileText}

JSON à remplir (TOUS les champs, analyses précises et concrètes):
{"nom":"","titre":"","entreprise":"","localisation":"","intro":"","p1_nom":"","p1_qui":"","p1_percoit":"","p1_verdict":"","p2_nom":"","p2_qui":"","p2_percoit":"","p2_verdict":"","p3_nom":"","p3_qui":"","p3_percoit":"","p3_verdict":"","p4_nom":"","p4_qui":"","p4_blocage":"","p4_verdict":"","algo_kw1":"","algo_text1":"","algo_kw2":"","algo_text2":"","algo_kw3":"","algo_text3":"","algo_kw4":"","algo_text4":"","algo_note":"","titre_citation":"","titre_analyse":"","titre_chip":"","about_citation":"","about_analyse":"","about_chip1":"","about_chip2":"","exp_analyse":"","posts_analyse":"","banniere_analyse":"","reco1":"","reco2":"","reco3":"","reco4":"","diag_positif_1":"","diag_positif_2":"","diag_positif_3":"","diag_negatif_1":"","diag_negatif_2":"","diag_negatif_3":""}`
        }]
      })
    });

    if (!claudeResp.ok) throw new Error(`Claude: ${claudeResp.status}`);
    const claudeData = await claudeResp.json();
    let raw = claudeData.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

    const a = JSON.parse(raw);

    // 3. Stockage du résultat (TTL 1h)
    const store = getStore({ name: 'diagnostics', siteID: process.env.SITE_ID, token: process.env.NETLIFY_TOKEN });
    await store.set(jobId, JSON.stringify(a), {
      expiration: Math.floor(Date.now() / 1000) + 3600
    });

    // 4. Envoi emails via Resend
    await Promise.all([
      sendResend(email, a, linkedin_url),
      sendNotification(email, a, linkedin_url)
    ]);

  } catch (err) {
    console.error('analyze-background error:', err);
  }
};

async function sendResend(email, a, linkedin_url) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'Sherpact <diagnostic@sherpact.com>',
      to: email,
      subject: `Votre diagnostic LinkedIn — ${a.nom || 'Résultats'}`,
      html: buildEmailHtml(a, linkedin_url)
    })
  });
  if (!resp.ok) console.error('Resend error:', resp.status, await resp.text());
}

async function sendNotification(email, a, linkedin_url) {
  const notifyEmail = 'thomas.servais@servais-consulting.com';//'laurent@sherpact.fr';
  if (!notifyEmail) return;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'Sherpact <diagnostic@sherpact.com>',
      to: notifyEmail,
      subject: `Nouveau diagnostic — ${email}`,
      html: `<p><strong>Nouveau diagnostic soumis</strong></p>
<p>Email : ${email}<br>Profil : <a href="${linkedin_url}">${linkedin_url}</a><br>Date : ${new Date().toLocaleString('fr-FR')}</p>
<hr style="border:none;border-top:1px solid #e8e4dc;margin:20px 0">
${buildEmailHtml(a, linkedin_url)}`
    })
  });
  if (!resp.ok) console.error('Resend notification error:', resp.status, await resp.text());
}

function buildEmailHtml(a, linkedin_url) {
  const s = `
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f4;margin:0;padding:0}
    .wrap{max-width:640px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e0e0e0}
    .header{background:#1a2840;padding:28px 32px}
    .header h1{color:#fff;margin:0 0 4px;font-size:20px;font-weight:600}
    .header p{color:#94a3b8;margin:0;font-size:13px}
    .intro{padding:24px 32px;background:#f8f9fb;border-bottom:1px solid #e8e8e8;font-size:14px;color:#444;line-height:1.7}
    .bloc{padding:24px 32px;border-bottom:1px solid #eee}
    .bloc-title{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#888;font-weight:600;margin:0 0 16px}
    .persona{background:#f9f9f9;border:1px solid #eee;border-radius:6px;padding:14px 16px;margin-bottom:10px}
    .persona-badge{display:inline-block;font-size:10px;padding:2px 8px;border-radius:20px;font-weight:600;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em}
    .bv{background:#dbeafe;color:#1d4ed8}
    .bp{background:#fce7f3;color:#be185d}
    .bs{background:#fef9c3;color:#92400e}
    .persona-name{font-weight:600;font-size:14px;color:#111;margin-bottom:6px}
    .persona-label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em;margin:8px 0 2px}
    .persona-val{font-size:13px;color:#333;line-height:1.6}
    .persona-verdict{font-size:13px;color:#555;font-style:italic;margin-top:8px;padding-top:8px;border-top:1px solid #eee}
    .algo{background:#f0f4ff;border-radius:6px;padding:14px 16px;margin-top:12px}
    .algo-title{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6366f1;font-weight:600;margin-bottom:10px}
    .algo-item{font-size:13px;color:#333;line-height:1.6;padding:4px 0;border-bottom:1px solid #e0e4f0}
    .algo-item:last-child{border-bottom:none}
    .algo-kw{font-weight:600;color:#4f46e5}
    .algo-note{font-size:12px;color:#6366f1;font-style:italic;margin-top:10px}
    .sig-item{padding:12px 0;border-bottom:1px solid #f0f0f0}
    .sig-item:last-child{border-bottom:none}
    .sig-tag{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#888;font-weight:600;margin-bottom:4px}
    .sig-quote{font-size:13px;color:#555;font-style:italic;margin-bottom:6px;padding-left:10px;border-left:2px solid #ddd}
    .sig-read{font-size:13px;color:#333;line-height:1.6}
    .chip{display:inline-block;font-size:11px;padding:2px 8px;border-radius:20px;background:#ede9fe;color:#6d28d9;margin:4px 4px 0 0}
    .reco-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
    .reco-item{background:#f9f9f9;border:1px solid #eee;border-radius:6px;padding:12px}
    .reco-who{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:4px;font-weight:600}
    .reco-text{font-size:13px;color:#333;line-height:1.6}
    .diag-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
    .diag-col-title{font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:8px}
    .diag-col-left .diag-col-title{color:#16a34a}
    .diag-col-right .diag-col-title{color:#dc2626}
    .diag-item{font-size:13px;color:#333;line-height:1.6;padding:4px 0;padding-left:14px;position:relative}
    .footer{padding:20px 32px;background:#f8f9fb;font-size:12px;color:#aaa;text-align:center}
    .footer a{color:#1a2840}
  `;

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><style>${s}</style></head>
<body><div class="wrap">

  <div class="header">
    <h1>${a.nom || ''}</h1>
    <p>${a.titre || ''} · ${a.entreprise || ''} · ${a.localisation || ''}</p>
  </div>

  <div class="intro">${a.intro || ''}</div>

  <!-- BLOC 1 : Personas -->
  <div class="bloc">
    <div class="bloc-title">Bloc 1 — Personas attirés par le profil</div>

    <div class="persona">
      <div><span class="persona-badge bv">Voulu</span></div>
      <div class="persona-name">${a.p1_nom || ''}</div>
      <div class="persona-label">Qui</div><div class="persona-val">${a.p1_qui || ''}</div>
      <div class="persona-label">Ce qu'il perçoit</div><div class="persona-val">${a.p1_percoit || ''}</div>
      <div class="persona-verdict">${a.p1_verdict || ''}</div>
    </div>

    <div class="persona">
      <div><span class="persona-badge bv">Voulu</span></div>
      <div class="persona-name">${a.p2_nom || ''}</div>
      <div class="persona-label">Qui</div><div class="persona-val">${a.p2_qui || ''}</div>
      <div class="persona-label">Ce qu'il perçoit</div><div class="persona-val">${a.p2_percoit || ''}</div>
      <div class="persona-verdict">${a.p2_verdict || ''}</div>
    </div>

    <div class="persona">
      <div><span class="persona-badge bp">Parasite</span></div>
      <div class="persona-name">${a.p3_nom || ''}</div>
      <div class="persona-label">Qui</div><div class="persona-val">${a.p3_qui || ''}</div>
      <div class="persona-label">Ce qu'il perçoit</div><div class="persona-val">${a.p3_percoit || ''}</div>
      <div class="persona-verdict">${a.p3_verdict || ''}</div>
    </div>

    <div class="persona">
      <div><span class="persona-badge bs">Possible · à valider</span></div>
      <div class="persona-name">${a.p4_nom || ''}</div>
      <div class="persona-label">Qui</div><div class="persona-val">${a.p4_qui || ''}</div>
      <div class="persona-label">Pourquoi il ne le voit pas</div><div class="persona-val">${a.p4_blocage || ''}</div>
      <div class="persona-verdict">${a.p4_verdict || ''}</div>
    </div>

    <div class="algo">
      <div class="algo-title">Visibilité algorithmique</div>
      ${[1,2,3,4].map(i => a[`algo_kw${i}`] ? `<div class="algo-item"><span class="algo-kw">${a[`algo_kw${i}`]}</span> — ${a[`algo_text${i}`] || ''}</div>` : '').join('')}
      ${a.algo_note ? `<div class="algo-note">${a.algo_note}</div>` : ''}
    </div>
  </div>

  <!-- BLOC 2 : Ce que le profil vend -->
  <div class="bloc">
    <div class="bloc-title">Bloc 2 — Ce que le profil vend réellement</div>

    <div class="sig-item">
      <div class="sig-tag">Titre</div>
      ${a.titre_citation ? `<div class="sig-quote">"${a.titre_citation}"</div>` : ''}
      <div class="sig-read">${a.titre_analyse || ''}</div>
      ${a.titre_chip ? `<span class="chip">${a.titre_chip}</span>` : ''}
    </div>

    <div class="sig-item">
      <div class="sig-tag">About complet</div>
      ${a.about_citation ? `<div class="sig-quote">"${a.about_citation}"</div>` : ''}
      <div class="sig-read">${a.about_analyse || ''}</div>
      ${a.about_chip1 ? `<span class="chip">${a.about_chip1}</span>` : ''}
      ${a.about_chip2 ? `<span class="chip">${a.about_chip2}</span>` : ''}
    </div>

    <div class="sig-item">
      <div class="sig-tag">Expériences récentes</div>
      <div class="sig-read">${a.exp_analyse || ''}</div>
    </div>

    <div class="sig-item">
      <div class="sig-tag">Posts récents</div>
      <div class="sig-read">${a.posts_analyse || ''}</div>
    </div>

    <div class="sig-item">
      <div class="sig-tag">Bannière + photo</div>
      <div class="sig-read">${a.banniere_analyse || ''}</div>
    </div>
  </div>

  <!-- BLOC 3 : Ce que chaque persona retient -->
  <div class="bloc">
    <div class="bloc-title">Bloc 3 — Ce que chaque persona retient</div>

    <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:16px">
      <tr>
        ${[1,2,3,4].map(i => `<td width="25%" style="padding:8px;vertical-align:top;background:#f9f9f9;border:1px solid #eee;border-radius:4px">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#888;font-weight:600;margin-bottom:6px">${a[`p${i}_nom`] || ''}</div>
          <div style="font-size:13px;color:#333;line-height:1.5">${a[`reco${i}`] || ''}</div>
        </td>`).join('')}
      </tr>
    </table>

    <div class="bloc-title" style="margin-top:16px">Premier diagnostic</div>
    <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
      <tr>
        <td width="50%" style="padding-right:12px;vertical-align:top">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#16a34a;font-weight:600;margin-bottom:8px">Ce que le profil fait</div>
          ${[1,2,3].map(i => a[`diag_positif_${i}`] ? `<div style="font-size:13px;color:#333;line-height:1.6;padding:3px 0 3px 14px;border-left:2px solid #16a34a;margin-bottom:6px">${a[`diag_positif_${i}`]}</div>` : '').join('')}
        </td>
        <td width="50%" style="padding-left:12px;vertical-align:top">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#dc2626;font-weight:600;margin-bottom:8px">Ce que le profil ne fait pas</div>
          ${[1,2,3].map(i => a[`diag_negatif_${i}`] ? `<div style="font-size:13px;color:#333;line-height:1.6;padding:3px 0 3px 14px;border-left:2px solid #dc2626;margin-bottom:6px">${a[`diag_negatif_${i}`]}</div>` : '').join('')}
        </td>
      </tr>
    </table>
  </div>

  <div class="footer">
    <p>Diagnostic pour <a href="${linkedin_url}">${linkedin_url}</a></p>
  </div>

</div></body></html>`;
}
