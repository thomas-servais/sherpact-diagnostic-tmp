exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return;

  try {
    const { linkedin_url, email } = JSON.parse(event.body);

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

    // 3. Envoi email
    if (process.env.EMAIL_PROVIDER === 'resend') {
      await sendResend(email, a, linkedin_url);
    } else {
      await sendEmailJS(email, a, linkedin_url);
    }

  } catch (err) {
    console.error('analyze-background error:', err);
  }
};

async function sendEmailJS(email, a, linkedin_url) {
  await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: 'service_p7rrpms',
      template_id: 'template_76n8eyi',
      user_id: 'xnJHMwfjpZluwkcUs',
      accessToken: process.env.EMAILJS_PRIVATE_KEY,
      template_params: {
        to_email: email,
        nom: a.nom || '',
        titre: a.titre || '',
        entreprise: a.entreprise || '',
        intro: a.intro || '',
        titre_analyse: a.titre_analyse || '',
        about_analyse: a.about_analyse || '',
        reco1: a.reco1 || '',
        reco2: a.reco2 || '',
        reco3: a.reco3 || '',
        reco4: a.reco4 || '',
        diag_positif_1: a.diag_positif_1 || '',
        diag_positif_2: a.diag_positif_2 || '',
        diag_positif_3: a.diag_positif_3 || '',
        diag_negatif_1: a.diag_negatif_1 || '',
        diag_negatif_2: a.diag_negatif_2 || '',
        diag_negatif_3: a.diag_negatif_3 || '',
        linkedin_url
      }
    })
  });
}

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
  if (!resp.ok) throw new Error(`Resend: ${resp.status}`);
}

function buildEmailHtml(a, linkedin_url) {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><style>
  body{font-family:-apple-system,sans-serif;background:#f5f5f5;margin:0;padding:0}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden}
  .header{background:#1a1a2e;padding:32px;text-align:center}
  .header h1{color:#fff;margin:0;font-size:22px}
  .header p{color:#aaa;margin:8px 0 0;font-size:14px}
  .body{padding:32px}
  .section{margin-bottom:24px}
  .section h2{font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#888;margin:0 0 10px}
  .card{background:#f9f9f9;border-radius:8px;padding:16px;font-size:14px;color:#333;line-height:1.6}
  .positif{color:#16a34a;margin:4px 0}
  .negatif{color:#dc2626;margin:4px 0}
  .reco{border-left:3px solid #5b3fdf;padding-left:12px;margin-bottom:10px;font-size:14px;color:#333}
  .footer{padding:24px 32px;border-top:1px solid #eee;font-size:12px;color:#aaa;text-align:center}
  .footer a{color:#5b3fdf}
</style></head>
<body><div class="wrap">
  <div class="header">
    <h1>Votre diagnostic LinkedIn</h1>
    <p>${a.nom || ''} · ${a.titre || ''}</p>
  </div>
  <div class="body">
    <p style="font-size:16px;color:#333;line-height:1.6">${a.intro || ''}</p>
    <div class="section"><h2>Titre</h2><div class="card">${a.titre_analyse || ''}</div></div>
    <div class="section"><h2>À propos</h2><div class="card">${a.about_analyse || ''}</div></div>
    <div class="section"><h2>Points forts & axes d'amélioration</h2><div class="card">
      ${[1,2,3].map(i => a[`diag_positif_${i}`] ? `<p class="positif">✓ ${a[`diag_positif_${i}`]}</p>` : '').join('')}
      ${[1,2,3].map(i => a[`diag_negatif_${i}`] ? `<p class="negatif">✗ ${a[`diag_negatif_${i}`]}</p>` : '').join('')}
    </div></div>
    <div class="section"><h2>Recommandations</h2>
      ${[1,2,3,4].map(i => a[`reco${i}`] ? `<div class="reco">${a[`reco${i}`]}</div>` : '').join('')}
    </div>
  </div>
  <div class="footer">
    <p>Diagnostic pour <a href="${linkedin_url}">${linkedin_url}</a></p>
  </div>
</div></body></html>`;
}
