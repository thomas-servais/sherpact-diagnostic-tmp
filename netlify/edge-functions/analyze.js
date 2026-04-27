const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const responseHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const { linkedin_url, email } = await request.json();

    // 1. RapidAPI scrape
    const rapidResp = await fetch(
      `https://fresh-linkedin-profile-data.p.rapidapi.com/enrich-lead?linkedin_url=${encodeURIComponent(linkedin_url)}&include_skills=false&include_certifications=false&include_profile_status=false&include_company_public_url=false`,
      {
        method: 'GET',
        headers: {
          'X-RapidAPI-Key': Deno.env.get('RAPIDAPI_KEY'),
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
        'x-api-key': Deno.env.get('ANTHROPIC_KEY'),
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

    const analysis = JSON.parse(raw);

    return new Response(
      JSON.stringify({ success: true, analysis, email, linkedin_url }),
      { status: 200, headers: responseHeaders }
    );

  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: responseHeaders }
    );
  }
};

export const config = { path: '/api/analyze' };
