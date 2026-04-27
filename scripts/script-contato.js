/* ============================================================
   script-contato.js
   Lógica exclusiva da página contato.html
   Depende de: i18next, script-shared.js
   ============================================================ */

dataReady.then(() => {

  /* ── FORMULÁRIO ── */
  const form     = document.getElementById('contactForm');
  const feedback = document.getElementById('formFeedback');

  emailjs.init('Rq3NnSh6M4ep2ARq_');

  /* F4 — validação em tempo real */
  const emailRegexLive = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  form.email.addEventListener('input', () => {
    const val = form.email.value.trim();
    if (val && !emailRegexLive.test(val)) {
      form.email.style.borderColor = 'rgba(255,80,80,0.6)';
    } else {
      form.email.style.borderColor = '';
    }
  });
  ['nome', 'assunto', 'mensagem'].forEach(name => {
    form[name].addEventListener('input', () => {
      form[name].style.borderColor = form[name].value.trim() ? '' : '';
    });
  });

  form.addEventListener('submit', e => {
    e.preventDefault();

    const lang     = i18next.language;
    const nome     = form.nome.value.trim();
    const email    = form.email.value.trim();
    const assunto  = form.assunto.value.trim();
    const mensagem = form.mensagem.value.trim();

    if (!nome || !email || !assunto || !mensagem) {
      feedback.textContent = lang === 'en'
        ? 'Please fill in all required fields.'
        : 'Preencha todos os campos obrigatórios.';
      feedback.className = 'form-feedback error';
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      feedback.textContent = lang === 'en' ? 'Invalid e-mail address.' : 'E-mail inválido.';
      feedback.className = 'form-feedback error';
      return;
    }

    const btn = form.querySelector('.btn-submit');
    btn.disabled = true;
    btn.style.opacity = '0.5';

    emailjs.send('service_2yrzyqh', 'template_lg3h37e', {
      nome,
      email,
      telefone: form.telefone.value.trim() || '—',
      assunto,
      mensagem,
    })
    .then(() => {
      feedback.textContent = lang === 'en'
        ? 'Message sent. We\'ll be in touch soon.'
        : 'Mensagem enviada. Entraremos em contato em breve.';
      feedback.className = 'form-feedback success';
      form.reset();
    })
    .catch(() => {
      feedback.textContent = lang === 'en'
        ? 'Something went wrong. Please try again.'
        : 'Algo deu errado. Tente novamente.';
      feedback.className = 'form-feedback error';
    })
    .finally(() => {
      btn.disabled = false;
      btn.style.opacity = '1';
    });
  });


  /* ── updateDOM (chamada pelo script-shared ao trocar idioma) ── */
  window.updateDOM = function() {
    applyI18n();
  };


  /* ── i18next ── */
  i18next.init({
    lng: localStorage.getItem('lang') || 'pt',
    resources: {
      pt: {
        translation: {
          ...COMMON_I18N.pt,
          'nav.portfolio':          'Portfólio',
          'nav.shop':               'Loja',
          'contact.eyebrow':        (pagesData.contato && pagesData.contato.eyebrowPt) || 'Fale com a gente',
          'contact.title':          (pagesData.contato && pagesData.contato.titlePt)   || 'Contato',
          'contact.sub':            (pagesData.contato && pagesData.contato.subPt)     || 'Estamos disponíveis para parcerias, imprensa e qualquer conversa sobre cinema.',
          'form.name':              'Nome',
          'form.phone':             'Telefone',
          'form.email':             'E-mail',
          'form.subject':           'Assunto',
          'form.message':           'Mensagem',
          'form.send':              'Enviar mensagem',
          'form.whatsapp':          'Prefere o WhatsApp?',
        }
      },
      en: {
        translation: {
          ...COMMON_I18N.en,
          'nav.portfolio':          'Portfolio',
          'nav.shop':               'Shop',
          'contact.eyebrow':        (pagesData.contato && pagesData.contato.eyebrowEn) || 'Get in touch',
          'contact.title':          (pagesData.contato && pagesData.contato.titleEn)   || 'Contact',
          'contact.sub':            (pagesData.contato && pagesData.contato.subEn)     || "We're available for partnerships, press, and any conversation about cinema.",
          'form.name':              'Name',
          'form.phone':             'Phone',
          'form.email':             'E-mail',
          'form.subject':           'Subject',
          'form.message':           'Message',
          'form.send':              'Send message',
          'form.whatsapp':          'Prefer WhatsApp?',
        }
      }
    }
  }, () => {
    // Atualiza link do WhatsApp com o número do data.json
    const waLink = document.getElementById('whatsappLink');
    if (waLink) {
      if (pagesData.contato && pagesData.contato.whatsapp) {
        waLink.href = `https://wa.me/${pagesData.contato.whatsapp}`;
        waLink.style.display = '';
      } else {
        waLink.style.display = 'none';
      }
    }
    observeReveal();
    updateDOM();
  });

}); // dataReady
