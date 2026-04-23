(() => {
  const stage = document.getElementById('living-stage');
  const lines = Array.from(document.querySelectorAll('.living-line'));
  const title = document.getElementById('panel-title');
  const copy = document.getElementById('panel-copy');
  const bullets = document.getElementById('panel-bullets');
  const links = document.getElementById('panel-links');
  const kicker = document.getElementById('panel-kicker');
  if (!stage || !lines.length || !title || !copy || !bullets || !links || !kicker) return;

  const content = {
    science: {
      kicker: 'Selected proof · Science',
      title: 'Science',
      copy: 'Two-dimensional infrared spectroscopy, biological systems, and structure work on hIAPP. The point is depth with method-level discipline.',
      bullets: [
        '2D-IR on biological systems',
        'selected publications and notes',
        'technical detail without overexposure',
      ],
      links: [
        { label: 'Research', href: 'research.html' },
        { label: 'Scholar', href: 'https://scholar.google.com/citations?user=GLnG-aUAAAAJ&hl=en' },
      ],
    },
    strategy: {
      kicker: 'Selected proof · Strategy',
      title: 'Strategy',
      copy: 'Biotech diligence, non-dilutive funding, R&D roadmaps, investor materials, and operator thinking that still respects the science.',
      bullets: [
        'diligence and landscape analysis',
        'funding and roadmap support',
        'clear judgment without consultant fog',
      ],
      links: [
        { label: 'Consulting', href: 'consulting.html' },
        { label: 'Contact', href: 'contact.html' },
      ],
    },
    build: {
      kicker: 'Selected proof · Build',
      title: 'Build',
      copy: 'Hands-on systems work, CNC experiments, fixtures, and the habit of making ideas leave evidence in the real world.',
      bullets: [
        'MPCNC and physical iteration',
        'fixtures, tooling, and practical systems',
        'code and hardware that have to earn their keep',
      ],
      links: [
        { label: 'MPCNC', href: 'MPCNC.html' },
        { label: 'GitHub', href: 'https://github.com/Type2Enthusiasm' },
      ],
    },
    contact: {
      kicker: 'Selected proof · Contact',
      title: 'Contact',
      copy: 'Direct works best. Email is the shortest path; the rest is there for verification, not performance.',
      bullets: [
        'email first',
        'LinkedIn when useful',
        'CV as quiet backup proof',
      ],
      links: [
        { label: 'Email', href: 'mailto:HarrisonJEsterly@gmail.com' },
        { label: 'LinkedIn', href: 'https://www.linkedin.com/in/harrison-esterly/' },
        { label: 'CV', href: 'downloads/CV[esterly].pdf' },
      ],
    },
  };

  function renderPanel(key) {
    const data = content[key] || content.science;
    kicker.textContent = data.kicker;
    title.textContent = data.title;
    copy.textContent = data.copy;
    bullets.innerHTML = data.bullets.map((item) => `<li>${item}</li>`).join('');
    links.innerHTML = data.links.map((item) => `<a href="${item.href}">${item.label}</a>`).join('');
  }

  function setActive(key) {
    lines.forEach((line) => {
      const active = line.dataset.key === key;
      line.classList.toggle('is-active', active);
      line.setAttribute('aria-pressed', String(active));
    });
    renderPanel(key);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function updateLineMotion(line, event) {
    const rect = line.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const mx = (x - 0.5) * 2;
    const my = (y - 0.5) * 2;
    line.style.setProperty('--mx', mx.toFixed(3));
    line.style.setProperty('--my', my.toFixed(3));
    line.dataset.hover = 'true';
    line.querySelectorAll('.line-token').forEach((token) => {
      const tx = Number(token.style.getPropertyValue('--tx') || 0);
      const ty = Number(token.style.getPropertyValue('--ty') || 0);
      token.style.transform = `translate3d(${(mx * tx * 14).toFixed(2)}px, ${(my * ty * 9).toFixed(2)}px, 0)`;
    });
  }

  function resetLineMotion(line) {
    line.dataset.hover = 'false';
    line.style.setProperty('--mx', '0');
    line.style.setProperty('--my', '0');
    line.querySelectorAll('.line-token').forEach((token) => {
      token.style.transform = 'translate3d(0, 0, 0)';
    });
  }

  lines.forEach((line) => {
    line.addEventListener('pointerenter', (event) => {
      setActive(line.dataset.key);
      updateLineMotion(line, event);
    });

    line.addEventListener('pointermove', (event) => {
      updateLineMotion(line, event);
    });

    line.addEventListener('pointerleave', () => {
      resetLineMotion(line);
    });

    line.addEventListener('click', () => {
      setActive(line.dataset.key);
    });
  });

  stage.addEventListener('pointerleave', () => {
    lines.forEach(resetLineMotion);
  });

  const initialKey = new URLSearchParams(window.location.search).get('line') || window.location.hash.replace('#', '');
  setActive(content[initialKey] ? initialKey : 'science');
})();
