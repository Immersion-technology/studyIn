/* StudyIn AI — visitor experience */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable (private mode) — keep working without it */
    }
  },
};

const visitorId = (() => {
  let id = store.get("studyin.visitor", null);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
    store.set("studyin.visitor", id);
  }
  return id;
})();

const ICONS = {
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  cap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2 9 10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5"/></svg>',
};

// `text` is used when a school is named, `general` when it isn't.
const TOPICS = [
  { label: "Entry requirements", text: "What are the entry requirements for a Nigerian student applying to an undergraduate degree at {school}? Include WAEC/NECO grades and English test options.", general: "Which universities in the UK and Canada accept Nigerian students with WAEC results, and what English test options do they accept?" },
  { label: "Tuition & fees", text: "How much is tuition for international students at {school} for the 2026/27 academic year, and what deposit is required?", general: "Which countries offer affordable tuition for international master's students, and what are typical fees?" },
  { label: "Scholarships", text: "What scholarships and discounts can a Nigerian student get at {school}, and how do I apply for them?", general: "What fully funded or partial scholarships can Nigerian students apply for to study abroad this year?" },
  { label: "Student visa", text: "Walk me through the student visa process for {school}: required documents, proof of funds and timelines.", general: "Compare the student visa process for the UK, Canada and the US: documents, proof of funds and timelines." },
  { label: "Courses", text: "What popular postgraduate programmes does {school} offer in business, computing and health?", general: "Which universities abroad are strong for a master's in Data Science and accept international students?" },
  { label: "Accommodation", text: "What accommodation options are there for international students at {school}, and what are typical monthly living costs?", general: "What are typical monthly living costs for international students in the UK, Canada and Ireland?" },
  { label: "Intakes & deadlines", text: "What are the intakes and application deadlines at {school} for international students?", general: "When are the main university intakes abroad, and how early should I apply?" },
  { label: "Work after study", text: "Can I work while studying at {school} and after I graduate? Explain the rules and options.", general: "Which study destinations let international students work after graduating, and for how long?" },
];

const FOLLOWUPS = {
  "Admissions & Entry Requirements": ["Do I need IELTS, or can I get an English waiver with WAEC?", "What documents should I prepare for my application?", "Are there foundation routes if my grades are lower?"],
  "Tuition & Fees": ["What scholarships could reduce these fees?", "Can I pay tuition in instalments?", "What are the total living costs for one year?"],
  "Scholarships & Funding": ["What is the full tuition before the scholarship?", "When are the scholarship deadlines?", "Can I work part-time to support myself?"],
  "Visa & Immigration": ["How much proof of funds do I need, and for how long?", "Can my spouse or children come with me?", "What happens at the visa interview or credibility check?"],
  "Courses & Programmes": ["What are the entry requirements for this programme?", "How much does this programme cost?", "Does it include a placement or internship year?"],
  "Accommodation & Living Costs": ["Is accommodation guaranteed for first-year students?", "How much part-time work is allowed?", "Which areas near campus are affordable?"],
  "Application Process & Deadlines": ["What documents do I need to apply?", "How long does an offer take?", "When should I start my visa application?"],
  "Careers & Post-Study Work": ["Which courses lead to the best job outcomes?", "Does the university have a careers service for international students?", "What internships are available?"],
  "Student Life & Support": ["Is there an African or Nigerian student society?", "What support is there for new international students?", "How safe is the city for students?"],
  Other: ["What are the entry requirements?", "How much is tuition for international students?", "What scholarships are available?"],
};

const PLACEHOLDERS = [
  "How much is the MSc Data Science and when is the next intake?",
  "Can I study with my WAEC results, or do I need IELTS?",
  "What scholarships are open to Nigerian students this year?",
  "How much proof of funds do I need for the student visa?",
  "Is accommodation guaranteed for first-year students?",
];

const state = {
  schools: [],
  country: "All",
  query: "",
  selected: null, // a partner school picked from the list
  schoolText: "", // whatever the visitor typed in the school field
  running: null,
  last: null,
};

/* ================= boot ================= */
init();

async function init() {
  $("#year").textContent = new Date().getFullYear();
  splitHeadline();
  setupReveal();
  setupNav();
  rotateTagline();
  requestAnimationFrame(() => document.body.classList.add("is-ready"));

  try {
    const cfg = await fetch("/api/config").then((r) => r.json());
    state.schools = cfg.schools;
    setupContact(cfg.contact);
    $("#prompt").maxLength = cfg.maxPromptChars;
  } catch {
    toast("Couldn't load the school list. Please refresh the page.");
  }
  setupSchoolInput();
  renderCountryFilters();
  renderSchools();
  renderStrip();
  renderTopics();
  setupComposer();
  setupResultActions();
  renderRecents();
}

/* ================= motion ================= */
function splitHeadline() {
  let i = 0;
  for (const line of $$(".split")) {
    line.innerHTML = line.textContent
      .trim()
      .split(/\s+/)
      .map((w) => `<span class="w"><span style="--i:${i++}">${w}</span></span>`)
      .join(" ");
  }
}

function setupReveal() {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
  );
  $$(".reveal").forEach((el) => io.observe(el));
}

function setupNav() {
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 30);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

function rotateTagline() {
  if (reduceMotion) return;
  const words = ["tuition & fees", "scholarships", "student visas", "entry requirements", "accommodation", "post-study work", "intakes & deadlines"];
  const host = $(".rotator");
  let i = 0;
  setInterval(() => {
    const old = host.querySelector(".rotator__word:not(.out)");
    old?.classList.add("out");
    setTimeout(() => old?.remove(), 500);
    i = (i + 1) % words.length;
    const next = document.createElement("span");
    next.className = "rotator__word";
    next.textContent = words[i];
    host.append(next);
  }, 3200);
}

function setupContact(contact) {
  if (!contact) return;
  const email = $("#contact-email");
  email.href = `mailto:${contact.email}`;
  email.querySelector("b").textContent = contact.email;
  const phone = $("#contact-phone");
  phone.href = `tel:${contact.phone.replace(/[^\d+]/g, "")}`;
  phone.querySelector("b").textContent = contact.phone;
}

/* ================= schools ================= */
// An all-caps short name ("LSBU") stays as is; otherwise use initials ("Example University" -> "EU").
const monogram = (s) =>
  /^[A-Z]{2,4}$/.test(s.short || "")
    ? s.short
    : s.name.split(/\s+/).filter((w) => !/^(of|the|and|for)$/i.test(w)).map((w) => w[0]).join("").slice(0, 3).toUpperCase();

function flag(cc) {
  if (!/^[a-z]{2}$/.test(cc || "")) return document.createTextNode("");
  const img = new Image();
  img.src = `/img/flags/${cc}.svg`;
  img.alt = "";
  img.className = "flag";
  return img;
}

/** The school the question is about: a partner, a typed name, or null for a general question. */
function currentSchool() {
  if (state.selected) return { ...state.selected, partner: true };
  const name = state.schoolText.trim();
  return name ? { name, partner: false } : null;
}

const findPartner = (text) => {
  const t = text.trim().toLowerCase();
  return t ? state.schools.find((s) => s.name.toLowerCase() === t || s.short?.toLowerCase() === t) || null : null;
};

function setupSchoolInput() {
  const input = $("#school-input");
  const list = $("#school-suggest");
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    active = -1;
  };
  const suggest = () => {
    const q = input.value.trim().toLowerCase();
    const matches = q
      ? state.schools.filter((s) => `${s.name} ${s.short || ""} ${s.city || ""} ${s.country || ""}`.toLowerCase().includes(q)).slice(0, 6)
      : [];
    list.innerHTML = "";
    if (!matches.length || state.selected) return close();
    matches.forEach((s, i) => {
      const li = document.createElement("li");
      li.role = "option";
      li.id = `suggest-${i}`;
      li.dataset.id = s.id;
      li.append(flag(s.cc), s.name, " ");
      li.append(Object.assign(document.createElement("span"), { className: "partner-badge", textContent: "Partner" }));
      li.append(Object.assign(document.createElement("small"), { textContent: s.city || s.country || "" }));
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectSchool(s.id);
        close();
      });
      list.append(li);
    });
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  const highlight = (i) => {
    const items = $$("li", list);
    active = (i + items.length) % items.length;
    items.forEach((li, k) => li.setAttribute("aria-selected", String(k === active)));
    input.setAttribute("aria-activedescendant", items[active].id);
  };

  input.addEventListener("input", () => {
    state.schoolText = input.value;
    state.selected = findPartner(input.value);
    updateSchoolUI();
    suggest();
  });
  input.addEventListener("keydown", (e) => {
    if (list.hidden) {
      if (e.key === "Enter") {
        e.preventDefault();
        $("#prompt").focus();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      highlight(active + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const li = $$("li", list)[active];
      if (li) selectSchool(li.dataset.id);
      close();
      $("#prompt").focus();
    } else if (e.key === "Escape") close();
  });
  input.addEventListener("blur", () => setTimeout(close, 120));
  $("#school-clear").addEventListener("click", () => {
    input.value = "";
    input.dispatchEvent(new Event("input"));
    input.focus();
  });
}

function updateSchoolUI() {
  const s = currentSchool();
  $$(".school").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.id === state.selected?.id)));
  $(".school-input").classList.toggle("is-partner", Boolean(state.selected));
  $("#school-clear").hidden = !state.schoolText;
  const hint = $("#school-hint");
  if (s?.partner) {
    hint.innerHTML = `<b></b> is a StudyIn partner school.`;
    hint.querySelector("b").textContent = s.name;
  } else if (s) {
    hint.textContent = "Our AI will research this school for you.";
  } else {
    hint.textContent = "Type any university, college or school, or leave it blank for general advice.";
  }
  $("#composer-school").classList.toggle("is-set", Boolean(s));
  if (s?.partner && s.cc) $("#composer-flag").replaceChildren(flag(s.cc));
  else $("#composer-flag").innerHTML = ICONS.cap;
  $("#composer-school-name").textContent = s ? s.name : "Any school";
  renderTopics();
}

function renderCountryFilters() {
  const countries = ["All", ...new Set(state.schools.map((s) => s.country))];
  const host = $("#country-filters");
  $(".school-tools").hidden = !state.schools.length;
  $("#partners-title").hidden = !state.schools.length;
  host.hidden = countries.length < 3;
  host.innerHTML = "";
  for (const c of countries) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(c === state.country));
    if (c !== "All") b.append(flag(state.schools.find((s) => s.country === c).cc));
    b.append(c);
    b.addEventListener("click", () => {
      state.country = c;
      $$(".chip", host).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      renderSchools();
    });
    host.append(b);
  }
  $("#school-search").addEventListener("input", (e) => {
    state.query = e.target.value.trim().toLowerCase();
    renderSchools();
  });
}

function renderSchools() {
  const grid = $("#school-grid");
  const list = state.schools.filter(
    (s) =>
      (state.country === "All" || s.country === state.country) &&
      (!state.query || `${s.name} ${s.short} ${s.city} ${s.country}`.toLowerCase().includes(state.query)),
  );
  grid.innerHTML = "";
  $("#school-empty").hidden = !state.schools.length || list.length > 0;
  list.forEach((s, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "school";
    b.style.setProperty("--i", i);
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(state.selected?.id === s.id));
    b.dataset.id = s.id;
    b.innerHTML = `
      <span class="school__check">${ICONS.check}</span>
      <span class="school__top"><span class="school__mono"></span><span class="school__flag"></span></span>
      <span class="school__name"></span>
      <span class="school__city"></span>`;
    b.querySelector(".school__mono").textContent = monogram(s);
    b.querySelector(".school__flag").append(flag(s.cc));
    b.querySelector(".school__name").textContent = s.name;
    b.querySelector(".school__city").textContent = `${s.city} · ${s.country}`;
    b.addEventListener("click", () => selectSchool(s.id));
    grid.append(b);
  });
}

function selectSchool(id, { scroll = false } = {}) {
  const s = state.schools.find((x) => x.id === id);
  if (!s) return;
  state.selected = s;
  state.schoolText = s.name;
  $("#school-input").value = s.name;
  updateSchoolUI();
  if (scroll) $("#step-prompt").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
}

function renderStrip() {
  const track = $("#strip-track");
  $("#schools-strip").hidden = !state.schools.length;
  $('.nav__links a[href="#schools-strip"]').hidden = !state.schools.length;
  const items = [...state.schools, ...state.schools];
  track.innerHTML = "";
  for (const s of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "strip__item";
    b.append(flag(s.cc), Object.assign(document.createElement("b"), { textContent: s.name }));
    b.addEventListener("click", () => {
      selectSchool(s.id);
      $("#ask").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
      setTimeout(() => $("#prompt").focus({ preventScroll: true }), 700);
    });
    track.append(b);
  }
}

/* ================= composer ================= */
function renderTopics() {
  const host = $("#topic-chips");
  host.innerHTML = "";
  for (const t of TOPICS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = t.label;
    b.addEventListener("click", () => {
      const ta = $("#prompt");
      const school = currentSchool();
      ta.value = school ? t.text.replace("{school}", school.name) : t.general;
      ta.dispatchEvent(new Event("input"));
      ta.focus();
    });
    host.append(b);
  }
}

function setupComposer() {
  const ta = $("#prompt");
  const count = $("#char-count");
  const autosize = () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(280, ta.scrollHeight) + "px";
    count.textContent = ta.value.length;
  };
  ta.addEventListener("input", autosize);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      $("#composer").requestSubmit();
    }
  });
  $("#composer").addEventListener("submit", (e) => {
    e.preventDefault();
    submitQuestion();
  });
  typePlaceholders(ta);
}

function typePlaceholders(ta) {
  if (reduceMotion) { ta.placeholder = PLACEHOLDERS[0]; return; }
  let p = 0, i = 0, deleting = false;
  const tick = () => {
    const text = PLACEHOLDERS[p];
    if (document.activeElement === ta || ta.value) {
      ta.placeholder = text;
      return setTimeout(tick, 600);
    }
    i += deleting ? -1 : 1;
    ta.placeholder = text.slice(0, i) + (deleting ? "" : "▍");
    let delay = deleting ? 18 : 42;
    if (!deleting && i >= text.length) { deleting = true; delay = 2200; ta.placeholder = text; }
    else if (deleting && i <= 0) { deleting = false; p = (p + 1) % PLACEHOLDERS.length; delay = 300; }
    setTimeout(tick, delay);
  };
  tick();
}

function shake(el) {
  el.classList.remove("shake");
  void el.offsetWidth;
  el.classList.add("shake");
}

function submitQuestion() {
  const prompt = $("#prompt").value.trim();
  if (prompt.length < 3) {
    toast("Type your question first.");
    shake($("#composer"));
    $("#prompt").focus();
    return;
  }
  if (state.running) return;
  ask(currentSchool(), prompt);
}

/** Result header label: flag + name (+ partner badge), or "General question". */
function schoolLabel(school, prefix = "") {
  if (!school) return ["General question"];
  const parts = [flag(school.cc), prefix + school.name];
  if (school.partner) parts.push(" ", Object.assign(document.createElement("span"), { className: "partner-badge", textContent: "Partner" }));
  return parts;
}

/* ================= asking ================= */
const STAGES = ["thinking", "searching", "reading", "writing"];

function setStage(stage) {
  const idx = STAGES.indexOf(stage === "analysing" ? "reading" : stage);
  if (idx < 0) return;
  $$("#tracker li").forEach((li, i) => {
    li.classList.toggle("is-active", i === idx);
    li.classList.toggle("is-done", i < idx);
  });
}

function finishTracker() {
  $$("#tracker li").forEach((li) => { li.classList.remove("is-active"); li.classList.add("is-done"); });
}

function resetResult(school, prompt) {
  const r = $("#result");
  r.hidden = false;
  r.style.animation = "none";
  void r.offsetWidth;
  r.style.animation = "";
  $("#result-school").replaceChildren(...schoolLabel(school));
  $("#result-question").textContent = prompt;
  $("#result-category").hidden = true;
  $("#result-flag-tag").hidden = true;
  $("#flag-note").hidden = true;
  $("#result-timer").textContent = "0.0s";
  $("#tracker").hidden = false;
  $$("#tracker li").forEach((li) => li.classList.remove("is-active", "is-done"));
  $("#answer-body").innerHTML = "";
  setWaiting(false);
  $("#result-error").hidden = true;
  $("#sources").hidden = true;
  $("#sources-grid").innerHTML = "";
  $("#result-foot").hidden = true;
  $("#followups").hidden = true;
  $("#cancel-btn").hidden = false;
  const fb = $("#feedback");
  fb.classList.remove("is-locked");
  fb.hidden = false;
  $$(".fb", fb).forEach((b) => b.classList.remove("is-chosen"));
}

/** While researching, a looping StudyIn ad fills the answer area instead of sources. */
function setWaiting(on) {
  const box = $("#waiting");
  const video = $("#waiting-video");
  box.hidden = !on;
  if (on) {
    // Loaded on first use so the page itself stays light.
    if (!video.getAttribute("src")) video.src = "/video/studyin-ad.mp4";
    if (!reduceMotion) video.play().catch(() => {}); // the poster stays if autoplay is blocked
  } else {
    video.pause();
  }
}

const domainOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
};

function addSource(src) {
  const grid = $("#sources-grid");
  const existing = grid.querySelector(`[data-url="${CSS.escape(src.url)}"]`);
  if (existing) {
    if (src.cited && !existing.querySelector(".source__cited")) existing.querySelector(".source__domain").insertAdjacentHTML("afterbegin", '<span class="source__cited">Cited</span>');
    if (src.title && src.title !== src.url) existing.querySelector(".source__title").textContent = src.title;
    return;
  }
  const a = document.createElement("a");
  a.className = "source";
  a.href = src.url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.dataset.url = src.url;
  const domain = domainOf(src.url);
  a.innerHTML = `<span class="source__icon"></span><span class="source__text"><span class="source__title"></span><span class="source__domain">${src.cited ? '<span class="source__cited">Cited</span>' : ""}<span></span></span></span>`;
  a.querySelector(".source__icon").textContent = domain[0] || "•";
  a.querySelector(".source__title").textContent = src.title || domain;
  a.querySelector(".source__domain span:last-child").textContent = domain;
  grid.append(a);
  $("#sources").hidden = false;
  $("#source-count").textContent = `(${grid.children.length})`;
}

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

function renderMarkdown(text, { streaming = false } = {}) {
  const body = $("#answer-body");
  const html = DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: false }));
  const before = body.children.length;
  body.innerHTML = html;
  // Scroll wide tables inside a wrapper so the table itself can stay full width.
  for (const table of body.querySelectorAll("table")) {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    table.replaceWith(wrap);
    wrap.append(table);
  }
  for (let i = Math.max(0, before - 1); i < body.children.length; i++) {
    if (i >= before) body.children[i].classList.add("fade-in");
  }
  if (streaming) {
    let node = body;
    while (node.lastElementChild && !["TABLE", "THEAD", "TBODY", "TR", "HR", "BR"].includes(node.lastElementChild.tagName)) node = node.lastElementChild;
    const caret = document.createElement("span");
    caret.className = "caret";
    node.append(caret);
  }
}

async function ask(school, prompt) {
  resetResult(school, prompt);
  setWaiting(true);
  $("#result").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  const panel = $(".panel");
  const btn = $("#ask-btn");
  panel.classList.add("is-busy");
  btn.disabled = true;
  btn.classList.add("is-loading");
  btn.querySelector(".btn__label").textContent = "Researching…";

  const controller = new AbortController();
  const run = { controller, school, prompt, answer: "", checkpoint: 0, sources: [], category: null, queryId: null, ok: false };
  state.running = run;
  state.last = { school, prompt };

  const t0 = performance.now();
  const timer = setInterval(() => ($("#result-timer").textContent = `${((performance.now() - t0) / 1000).toFixed(1)}s`), 100);
  let frame = 0;
  const scheduleRender = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      setWaiting(false);
      renderMarkdown(run.answer, { streaming: true });
    });
  };

  // Short text written before a tool call is the model announcing its research, not the answer.
  const dropPreamble = () => {
    const since = run.answer.slice(run.checkpoint);
    if (since.trim() && since.length < 600) {
      run.answer = run.answer.slice(0, run.checkpoint);
      if (!run.answer) { $("#answer-body").innerHTML = ""; setWaiting(true); }
      else scheduleRender();
    }
    run.checkpoint = run.answer.length;
  };

  const handlers = {
    meta: (d) => (run.queryId = d.queryId),
    category: (d) => {
      run.category = d.category;
      run.flagged = d.flagged;
      const tag = $("#result-category");
      tag.textContent = d.category;
      tag.hidden = d.flagged;
      $("#result-flag-tag").hidden = !d.flagged;
      $("#flag-note").hidden = !d.flagged;
      // For a general question, show the school the AI found in it.
      if (!school && d.school && !d.flagged) {
        run.detectedSchool = { name: d.school, partner: false };
        $("#result-school").replaceChildren(...schoolLabel(run.detectedSchool, "About: "));
      }
    },
    status: (d) => {
      if (["searching", "reading", "analysing"].includes(d.stage)) dropPreamble();
      setStage(d.stage);
    },
    // Sources are collected quietly and shown once the answer is complete.
    source: (d) => run.sources.push(d),
    text: (d) => { run.answer += d.delta; scheduleRender(); },
    done: (d) => { run.ok = true; run.meta = d; },
    error: (d) => { run.error = d.message; },
  };

  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schoolId: school?.partner ? school.id : undefined, school: school?.name, prompt, visitorId }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Something went wrong. Please try again.");
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let event = "message", data = "";
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (data && handlers[event]) {
          try { handlers[event](JSON.parse(data)); } catch (e) { console.warn("bad event", event, e); }
        }
      }
    }
    if (!run.ok && !run.error) run.error = "The connection dropped before the answer finished. Please try again.";
  } catch (err) {
    if (controller.signal.aborted) run.cancelled = true;
    else run.error = err.message || "Something went wrong. Please try again.";
  } finally {
    clearInterval(timer);
    cancelAnimationFrame(frame);
    state.running = null;
    panel.classList.remove("is-busy");
    btn.disabled = false;
    btn.classList.remove("is-loading");
    btn.querySelector(".btn__label").textContent = "Research this";
    $("#cancel-btn").hidden = true;
    setWaiting(false);
    finalise(run);
  }
}

function finalise(run) {
  if (run.answer) renderMarkdown(run.answer);
  if (run.ok) {
    finishTracker();
    for (const s of run.sources) addSource(s);
    $("#result-foot").hidden = false;
    showFollowups(run.category);
    saveRecent(run);
    if (run.meta?.truncated) toast("The answer was very long and got cut short. Try a narrower question.");
  } else if (run.cancelled) {
    $$("#tracker li").forEach((li) => li.classList.remove("is-active"));
    toast("Stopped.");
    if (run.answer) {
      $("#result-foot").hidden = false;
      $("#feedback").hidden = true;
    }
  } else {
    $$("#tracker li").forEach((li) => li.classList.remove("is-active"));
    $("#result-error").hidden = false;
    $("#result-error-text").textContent = run.error;
  }
  state.current = run;
}

function showFollowups(category) {
  const host = $("#followup-chips");
  host.innerHTML = "";
  for (const q of FOLLOWUPS[category] || FOLLOWUPS.Other) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = q;
    b.addEventListener("click", () => {
      const ta = $("#prompt");
      ta.value = q;
      ta.dispatchEvent(new Event("input"));
      $("#step-prompt").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      ta.focus({ preventScroll: true });
    });
    host.append(b);
  }
  $("#followups").hidden = false;
}

/* ================= result actions ================= */
const schoolOf = (run) => run.school || run.detectedSchool || null;
const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

function asMarkdown(run) {
  const label = schoolOf(run)?.name || "General question";
  const lines = [`# ${run.prompt}`, `_${label} · StudyIn AI · ${new Date().toLocaleDateString()}_`, "", run.answer];
  if (run.sources.length) {
    lines.push("", "## Sources", ...run.sources.map((s) => `- [${s.title || s.url}](${s.url})`));
  }
  return lines.join("\n");
}

function setupResultActions() {
  $("#cancel-btn").addEventListener("click", () => state.running?.controller.abort());
  $("#retry-btn").addEventListener("click", () => state.last && !state.running && ask(state.last.school, state.last.prompt));

  $("#result-foot").addEventListener("click", async (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    const run = state.current;
    if (!action || !run) return;
    if (action === "copy") {
      try {
        await navigator.clipboard.writeText(asMarkdown(run));
        toast("Copied to clipboard.");
      } catch {
        toast("Couldn't copy. Select the text instead.");
      }
    } else if (action === "download") {
      const blob = new Blob([asMarkdown(run)], { type: "text/markdown" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `StudyIn-${slug(schoolOf(run)?.name || "answer")}-${Date.now()}.md`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } else if (action === "print") {
      print();
    }
  });

  $("#feedback").addEventListener("click", async (e) => {
    const btn = e.target.closest(".fb");
    const run = state.current;
    if (!btn || !run?.queryId || $("#feedback").classList.contains("is-locked")) return;
    btn.classList.add("is-chosen");
    $("#feedback").classList.add("is-locked");
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queryId: run.queryId, rating: btn.dataset.rating }),
      });
      toast(btn.dataset.rating === "up" ? "Thanks! Glad it helped." : "Thanks. We'll use this to improve.");
    } catch {
      toast("Couldn't send feedback.");
    }
  });
}

/* ================= recents ================= */
function saveRecent(run) {
  const list = store.get("studyin.recents", []).filter((r) => r.queryId !== run.queryId);
  const school = schoolOf(run);
  list.unshift({
    queryId: run.queryId,
    school: school ? { name: school.name, partner: Boolean(school.partner), cc: school.cc || null, id: school.id || null } : null,
    flagged: Boolean(run.flagged),
    prompt: run.prompt,
    answer: run.answer,
    sources: run.sources.slice(0, 30),
    category: run.category,
    ts: Date.now(),
  });
  store.set("studyin.recents", list.slice(0, 6));
  renderRecents();
}

function renderRecents() {
  const list = store.get("studyin.recents", []);
  const host = $("#recent-list");
  host.innerHTML = "";
  $("#recents").hidden = !list.length;
  for (const r of list) {
    if (!r.answer) continue;
    const school = r.school ?? null;
    const li = document.createElement("li");
    li.innerHTML = `<button type="button"><span class="q"></span><span class="s"></span></button>`;
    li.querySelector(".q").textContent = r.prompt;
    li.querySelector(".s").append(flag(school?.cc), school?.name || "General");
    li.querySelector("button").addEventListener("click", () => openRecent(r, school));
    host.append(li);
  }
}

function openRecent(r, school) {
  if (state.running) return;
  resetResult(school, r.prompt);
  $("#cancel-btn").hidden = true;
  $("#tracker").hidden = true;
  if (r.category && !r.flagged) {
    $("#result-category").textContent = r.category;
    $("#result-category").hidden = false;
  }
  $("#result-flag-tag").hidden = !r.flagged;
  $("#result-timer").textContent = new Date(r.ts).toLocaleString();
  for (const s of r.sources || []) addSource(s);
  renderMarkdown(r.answer);
  $("#result-foot").hidden = false;
  $("#feedback").hidden = true;
  showFollowups(r.category);
  state.current = { school, prompt: r.prompt, answer: r.answer, sources: r.sources || [], queryId: r.queryId, flagged: r.flagged };
  $("#result").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}

/* ================= toast ================= */
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}
