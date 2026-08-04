// --- Sound Manager ---
class SoundManager {
    constructor() {
        this.ctx = null;
        this.muted = localStorage.getItem('sscDailyMuted') === 'true';
        this.updateIcon();

        document.getElementById('mute-btn').addEventListener('click', () => {
            this.muted = !this.muted;
            localStorage.setItem('sscDailyMuted', this.muted);
            this.updateIcon();
            if (!this.muted) this.initCtx();
        });
    }

    initCtx() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    updateIcon() {
        document.getElementById('mute-icon').textContent = this.muted ? '🔇' : '🔊';
    }

    playClick() {
        if (this.muted) return;
        this.initCtx();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.1);
    }

    playCorrect() {
        if (this.muted) return;
        this.initCtx();
        // Major chord arpeggio
        [440, 554.37, 659.25].forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.1, this.ctx.currentTime + i * 0.1);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + i * 0.1 + 0.3);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(this.ctx.currentTime + i * 0.1);
            osc.stop(this.ctx.currentTime + i * 0.1 + 0.3);
        });
    }

    playWrong() {
        if (this.muted) return;
        this.initCtx();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(100, this.ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.3);
    }
}

const soundManager = new SoundManager();

// --- Theme Manager ---
const themeManager = {
    isDark: localStorage.getItem('sscDailyTheme') === 'dark',
    init() {
        this.updateTheme();
        const themeBtn = document.getElementById('theme-btn');
        if (themeBtn) {
            themeBtn.addEventListener('click', () => {
                this.isDark = !this.isDark;
                localStorage.setItem('sscDailyTheme', this.isDark ? 'dark' : 'light');
                this.updateTheme();
            });
        }
    },
    updateTheme() {
        if (this.isDark) {
            document.documentElement.setAttribute('data-theme', 'dark');
            document.getElementById('theme-icon').textContent = '☀️';
        } else {
            document.documentElement.removeAttribute('data-theme');
            document.getElementById('theme-icon').textContent = '🌙';
        }
    }
};

// --- State ---
let questions = [];
let todayQuestion = null;
let timerInterval = null;
let countdownInterval = null;
let timeTakenSeconds = 0;
let selectedOptionIndex = null;

const views = {
    countdown: document.getElementById('countdown-view'),
    question: document.getElementById('question-view'),
    result: document.getElementById('result-view')
};

// --- Initialization ---
async function init() {
    themeManager.init();
    loadStreakHeader();
    await fetchQuestions();

    const gameState = getGameState();
    const { gameDateStr, nextDropTimeMs } = getGameTimeInfo();

    todayQuestion = questions.find(q => q.date === gameDateStr);

    if (!todayQuestion) {
        startCountdown(nextDropTimeMs);
        showView('countdown');
        return;
    }

    if (gameState.lastAnsweredDate === gameDateStr) {
        showResultView(gameState, nextDropTimeMs);
    } else {
        const prevGameDateStr = getPrevGameDateStr(gameDateStr);
        if (gameState.lastAnsweredDate && gameState.lastAnsweredDate !== prevGameDateStr) {
            gameState.streak = 0;
            saveGameState(gameState);
            loadStreakHeader();
        }
        setupQuestionView(todayQuestion);
    }
}

// --- Time Logic ---
function getGameTimeInfo() {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const nowUtc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const nowIst = new Date(nowUtc + istOffset);

    let gameYear = nowIst.getFullYear();
    let gameMonth = nowIst.getMonth();
    let gameDate = nowIst.getDate();

    if (nowIst.getHours() < 8) {
        const yesterday = new Date(nowIst);
        yesterday.setDate(yesterday.getDate() - 1);
        gameYear = yesterday.getFullYear();
        gameMonth = yesterday.getMonth();
        gameDate = yesterday.getDate();
    }

    const gameDateStr = `${gameYear}-${String(gameMonth + 1).padStart(2, '0')}-${String(gameDate).padStart(2, '0')}`;

    const nextDropIst = new Date(nowIst);
    if (nowIst.getHours() >= 8) {
        nextDropIst.setDate(nextDropIst.getDate() + 1);
    }
    nextDropIst.setHours(8, 0, 0, 0);

    const nextDropTimeMs = nextDropIst.getTime() - nowIst.getTime();
    return { gameDateStr, nextDropTimeMs: now.getTime() + nextDropTimeMs };
}

function getPrevGameDateStr(currentStr) {
    const d = new Date(currentStr);
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// --- Data Handling ---
async function fetchQuestions() {
    try {
        const response = await fetch('questions.json');
        questions = await response.json();
    } catch (e) {
        console.error("Failed to load questions", e);
    }
}

function getGameState() {
    const saved = localStorage.getItem('sscDailyState');
    return saved ? JSON.parse(saved) : { streak: 0, lastAnsweredDate: null, history: {} };
}

function saveGameState(state) {
    localStorage.setItem('sscDailyState', JSON.stringify(state));
}

function loadStreakHeader() {
    const state = getGameState();
    const streakEl = document.getElementById('header-streak-count');
    const headerEl = document.getElementById('streak-header');
    const flameEl = document.getElementById('header-flame');

    streakEl.textContent = state.streak;
    headerEl.style.display = state.streak > 0 ? 'flex' : 'none';

    if (state.streak >= 3) {
        flameEl.classList.add('flicker');
    } else {
        flameEl.classList.remove('flicker');
    }
}

// --- View Management ---
function showView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
}

// --- Question View ---
function setupQuestionView(q) {
    document.getElementById('question-category').textContent = q.category;
    document.getElementById('question-text').textContent = q.question;

    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = '';

    q.options.forEach((opt, index) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = opt;
        btn.onclick = () => selectOption(index, btn);
        optionsContainer.appendChild(btn);
    });

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.onclick = submitAnswer;
    submitBtn.disabled = true;

    showView('question');

    timeTakenSeconds = 0;
    const timerVal = document.getElementById('timer-val');
    timerVal.textContent = '0';

    timerInterval = setInterval(() => {
        timeTakenSeconds++;
        timerVal.textContent = timeTakenSeconds;
        // Subtle tick animation
        timerVal.style.transform = 'scale(1.1)';
        setTimeout(() => timerVal.style.transform = 'scale(1)', 100);
    }, 1000);
}

function selectOption(index, btnEl) {
    soundManager.playClick();
    selectedOptionIndex = index;
    document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
    btnEl.classList.add('selected');
    document.getElementById('submit-btn').disabled = false;
}

function submitAnswer() {
    clearInterval(timerInterval);

    const isCorrect = selectedOptionIndex === todayQuestion.correctIndex;
    const { gameDateStr, nextDropTimeMs } = getGameTimeInfo();
    const state = getGameState();

    const selectedBtn = document.querySelectorAll('.option-btn')[selectedOptionIndex];

    if (isCorrect) {
        soundManager.playCorrect();
        selectedBtn.classList.add('correct-answer');

        // Confetti
        if (typeof confetti === 'function') {
            confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 },
                colors: ['#10b981', '#6366f1', '#f59e0b']
            });
        }

        setTimeout(() => {
            state.streak += 1;
            finalizeSubmit(state, gameDateStr, nextDropTimeMs, isCorrect);
        }, 1200);
    } else {
        soundManager.playWrong();
        selectedBtn.classList.add('wrong-answer');

        // Highlight correct answer
        setTimeout(() => {
            const correctBtn = document.querySelectorAll('.option-btn')[todayQuestion.correctIndex];
            correctBtn.classList.add('correct-answer');
            correctBtn.style.animation = 'none'; // remove pulse
        }, 500);

        setTimeout(() => {
            state.streak = 0;
            finalizeSubmit(state, gameDateStr, nextDropTimeMs, isCorrect);
        }, 1500);
    }
}

function finalizeSubmit(state, gameDateStr, nextDropTimeMs, isCorrect) {
    state.lastAnsweredDate = gameDateStr;
    state.history[gameDateStr] = {
        correct: isCorrect,
        time: timeTakenSeconds,
        selected: selectedOptionIndex
    };
    saveGameState(state);

    if (document.startViewTransition) {
        document.startViewTransition(() => {
            loadStreakHeader();
            showResultView(state, nextDropTimeMs, true);
        });
    } else {
        loadStreakHeader();
        showResultView(state, nextDropTimeMs, true);
    }
}

// --- Result View ---
function showResultView(state, nextDropTimeMs, justAnswered = false) {
    const { gameDateStr } = getGameTimeInfo();
    const history = state.history[gameDateStr];

    if (!todayQuestion) {
        todayQuestion = questions.find(q => q.date === gameDateStr);
    }

    const statusEl = document.getElementById('result-status');
    if (history.correct) {
        statusEl.textContent = "Correct!";
        statusEl.className = "result-status correct display-font";
    } else {
        statusEl.textContent = "Incorrect";
        statusEl.className = "result-status incorrect display-font";
    }

    // Animate stats counting up if just answered
    const timeEl = document.getElementById('result-time');
    const streakEl = document.getElementById('result-streak');

    if (justAnswered) {
        animateNumber(timeEl, 0, history.time, 's');
        animateNumber(streakEl, 0, state.streak, ' 🔥');
    } else {
        timeEl.textContent = `${history.time}s`;
        streakEl.textContent = `${state.streak} 🔥`;
    }

    if (todayQuestion) {
        document.getElementById('result-explanation').textContent = todayQuestion.explanation;
    }

    document.getElementById('share-btn').onclick = async () => await shareResult(history, state.streak);

    startCountdown(nextDropTimeMs, 'result-countdown');
    showView('result');
}

function animateNumber(el, start, end, suffix) {
    let current = start;
    const duration = 1000;
    const stepTime = Math.abs(Math.floor(duration / (end - start || 1)));

    if (start === end) {
        el.textContent = end + suffix;
        return;
    }

    const timer = setInterval(() => {
        current += 1;
        el.textContent = current + suffix;
        if (current === end) {
            clearInterval(timer);
        }
    }, stepTime);
}

// --- Countdown Logic ---
function startCountdown(targetTimeMs, elementId = 'countdown-timer') {
    if (countdownInterval) clearInterval(countdownInterval);

    const el = document.getElementById(elementId);
    const circle = document.querySelector('.progress-ring__value');
    const radius = circle ? circle.r.baseVal.value : 0;
    const circumference = radius * 2 * Math.PI;

    if (circle) {
        circle.style.strokeDasharray = `${circumference} ${circumference}`;
        circle.style.strokeDashoffset = circumference;
    }

    const update = () => {
        const now = new Date().getTime();
        const diff = targetTimeMs - now;

        if (diff <= 0) {
            el.textContent = "00:00:00";
            clearInterval(countdownInterval);
            setTimeout(() => window.location.reload(), 1000);
            return;
        }

        const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);

        el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

        if (circle && elementId === 'countdown-timer') {
            const totalMsInDay = 24 * 60 * 60 * 1000;
            const percentage = diff / totalMsInDay;
            const offset = circumference - percentage * circumference;
            circle.style.strokeDashoffset = offset;
        }
    };

    update();
    countdownInterval = setInterval(update, 1000);
}

// --- Share Logic (Canvas) ---
async function generateShareImage(history, streak) {
    const canvas = document.getElementById('share-canvas');
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = themeManager.isDark ? '#111827' : '#fcfcfd';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Header gradient
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
    gradient.addColorStop(0, themeManager.isDark ? '#1f2937' : '#111827');
    gradient.addColorStop(1, themeManager.isDark ? '#818cf8' : '#6366f1');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, 80);

    // Logo text
    ctx.fillStyle = 'white';
    ctx.font = 'bold 36px sans-serif'; // Fallback to safe fonts
    ctx.fillText('Aaj Ka Sawaal', 30, 55);

    // Question number
    ctx.font = '24px sans-serif';
    ctx.fillText(`#${todayQuestion ? todayQuestion.id : ''}`, canvas.width - 80, 52);

    // Result icon and text
    const isCorrect = history.correct;
    ctx.fillStyle = isCorrect ? '#10b981' : '#ef4444';
    ctx.font = 'bold 64px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(isCorrect ? 'Correct!' : 'Incorrect', canvas.width / 2, 170);

    // Stats boxes
    ctx.textAlign = 'left';

    // Box 1 - Time
    ctx.fillStyle = themeManager.isDark ? '#1f2937' : 'white';
    ctx.shadowColor = 'rgba(0,0,0,0.1)';
    ctx.shadowBlur = 15;
    ctx.roundRect = function (x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        this.beginPath();
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + w, y, r);
        this.closePath();
        return this;
    }

    ctx.roundRect(80, 220, 200, 120, 16).fill();
    ctx.roundRect(320, 220, 200, 120, 16).fill();

    ctx.shadowBlur = 0; // reset

    ctx.fillStyle = themeManager.isDark ? '#f3f4f6' : '#111827';
    ctx.textAlign = 'center';
    ctx.font = 'bold 42px sans-serif';
    ctx.fillText(`${history.time}s`, 180, 280);
    ctx.fillText(`${streak}`, 410, 280);

    // Emojis might not render well in all Canvas implementations, fallback to simple text
    ctx.font = '32px sans-serif';
    ctx.fillText('🔥', 455, 280);

    ctx.fillStyle = themeManager.isDark ? '#9ca3af' : '#6b7280';
    ctx.font = '18px sans-serif';
    ctx.fillText('TIME TAKEN', 180, 315);
    ctx.fillText('DAY STREAK', 420, 315);

    return new Promise(resolve => {
        canvas.toBlob(blob => {
            resolve(blob);
        }, 'image/png');
    });
}

async function shareResult(history, streak) {
    const shareText = `Aaj Ka Sawaal #${todayQuestion ? todayQuestion.id : ''} ${history.correct ? '✅' : '❌'}\nSolved in ${history.time}s 🔥 ${streak} day streak\nPlay today's question: ${window.location.href}`;

    try {
        const imageBlob = await generateShareImage(history, streak);
        const file = new File([imageBlob], 'aajkasawaal-result.png', { type: 'image/png' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                title: 'Aaj Ka Sawaal',
                text: shareText,
                files: [file]
            });
        } else if (navigator.share) {
            // Fallback to just text if files can't be shared
            await navigator.share({
                title: 'Aaj Ka Sawaal',
                text: shareText,
            });
        } else {
            // Desktop fallback
            navigator.clipboard.writeText(shareText).then(() => {
                showToast("Copied to clipboard!");
            });
        }
    } catch (e) {
        console.error("Share failed", e);
        navigator.clipboard.writeText(shareText).then(() => showToast("Copied to clipboard!"));
    }
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}

init();
