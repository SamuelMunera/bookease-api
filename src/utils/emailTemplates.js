function businessVerifyEmail(businessName, verifyUrl) {
  return {
    subject: `Verifica el email de ${businessName} – Slotly`,
    html: `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:40px 32px;background:#fff;">
  <p style="font-size:22px;font-weight:800;margin:0 0 8px;color:#111;">Slotly</p>
  <hr style="border:none;border-top:1px solid #eee;margin:0 0 24px;">
  <h1 style="font-size:18px;font-weight:700;color:#111;margin:0 0 12px;">
    Confirma el email de <em>${businessName}</em>
  </h1>
  <p style="font-size:14px;color:#444;line-height:1.6;margin:0 0 24px;">
    Haz clic en el botón para verificar tu negocio y habilitarlo en el catálogo.
  </p>
  <a href="${verifyUrl}" style="display:inline-block;padding:12px 28px;background:#d4a017;color:#000;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;">
    Verificar email
  </a>
  <p style="font-size:12px;color:#999;margin:24px 0 0;">
    Este enlace expira en 48 horas. Si no creaste este negocio, ignora este mensaje.
  </p>
</div>`,
  };
}

module.exports = { businessVerifyEmail };
