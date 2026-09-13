// ===== 전역 상태 =====
let countdownSeconds = 0;
let animationId;
let randomSoundIntervalId;
let timerWorker;
let lastVolumeFeedbackSoundTime = 0; // 볼륨 조절 피드백음 1.5초 이내 반복 방지용

// ===== Web Worker (백그라운드 타이머) =====
const workerCode = `
    let timerId = null;
    self.onmessage = function(e) {
        if (e.data === 'start') {
            if (timerId) clearInterval(timerId);
            timerId = setInterval(() => self.postMessage('tick'), 100);
        } else if (e.data === 'stop') {
            clearInterval(timerId);
            timerId = null;
        }
    };
`;
const workerUrl = URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' }));

// ===== 프로그레스 링 =====
const circle = document.querySelector('.ring-progress');
const circumference = 2 * Math.PI * circle.r.baseVal.value;
circle.style.strokeDasharray = `${circumference} ${circumference}`;
circle.style.strokeDashoffset = circumference;

function setProgress(percent) {
    circle.style.strokeDashoffset = circumference - (percent / 100 * circumference);
}

// START 시 노란 원을 일정한 속도로 채우는 애니메이션
let ringFillAnimationId = null;
const RING_FILL_DURATION_MS = 267;

function animateRingFill() {
    if (ringFillAnimationId) cancelAnimationFrame(ringFillAnimationId);
    setProgress(0);
    const start = performance.now();

    function frame(now) {
        const t = Math.min(1, (now - start) / RING_FILL_DURATION_MS);
        setProgress(t * 100);
        ringFillAnimationId = t < 1 ? requestAnimationFrame(frame) : null;
    }

    ringFillAnimationId = requestAnimationFrame(frame);
}

// ===== 사운드 =====
const startSound = new Audio('sounds/start.mp3');
const resetSound = new Audio('sounds/reset.mp3');
const beepSound = new Audio('sounds/beep.mp3');
const randomSound = new Audio('sounds/beep1.mp3'); // 20초 랜덤 비프용 (재사용)

function playSound(audio) {
    audio.currentTime = 0;
    audio.play().catch(error => console.error("사운드 재생 오류:", error));
}

// ===== Web Audio 컨텍스트 (백그라운드 유지) =====
let audioCtx = null;

function initWebAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

// 탭으로 복귀 시 오디오 컨텍스트 재개
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && animationId && audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
});

// ===== 볼륨 =====
const volumeControl = document.getElementById('volumeControl');
const volumeIcon = document.getElementById('volumeIcon');
const volumeBubble = document.getElementById('volumeBubble');
let volumeBubbleHideTimeoutId = null;
const VOLUME_BUBBLE_SHOW_MS = 1500; // 말풍선 표시 후 페이드 아웃까지 유지 시간

// 모든 사운드의 볼륨을 한 번에 설정
function updateAllVolumes() {
    const value = parseInt(volumeControl.value, 10) || 0;
    const volume = value / 100;
    beepSound.volume = volume;
    startSound.volume = volume;
    resetSound.volume = volume;
    volumeIcon.innerText = value === 0 ? '🔇' : '🔊';
}

// 볼륨 퍼센트 말풍선 (슬라이더 핸들 위, 1.5초 뒤 페이드 아웃)
function showVolumeBubble() {
    const value = parseInt(volumeControl.value, 10) || 0;
    volumeBubble.innerText = value + '%';

    const sliderRect = volumeControl.getBoundingClientRect();
    const handleX = sliderRect.left + sliderRect.width * (value / 100);
    volumeBubble.style.left = handleX + 'px';
    volumeBubble.style.top = (sliderRect.top - 15) + 'px';

    volumeBubble.classList.add('show');
    clearTimeout(volumeBubbleHideTimeoutId);
    volumeBubbleHideTimeoutId = setTimeout(() => volumeBubble.classList.remove('show'), VOLUME_BUBBLE_SHOW_MS);
}

// 볼륨 조절 피드백음 (1.5초 이내 반복 방지)
const VOLUME_FEEDBACK_MIN_INTERVAL_MS = 1500;
function playVolumeFeedbackSound() {
    const now = Date.now();
    if (now - lastVolumeFeedbackSoundTime < VOLUME_FEEDBACK_MIN_INTERVAL_MS) return;
    lastVolumeFeedbackSoundTime = now;
    playSound(beepSound);
}
// ===== 타이머 표시/계산 =====
function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function readDuration() {
    return parseInt(document.getElementById('timerDuration').value, 10) || 100;
}

function updateCountdownDisplay() {
    document.getElementById('countdownTimer').innerText = formatTime(countdownSeconds);
}

function initializeCountdownDisplay() {
    countdownSeconds = readDuration();
    updateCountdownDisplay();
    setProgress(0); // 시작 전/리셋 후에는 노란 원을 비워 둔다
}

// ===== 설정 저장/불러오기 =====
function saveSettings() {
    const settings = {
        mainDuration: document.getElementById('timerDuration').value,
        volume: volumeControl.value
    };
    localStorage.setItem('mapleTimerSettings', JSON.stringify(settings));
}

function loadSettings() {
    const settings = JSON.parse(localStorage.getItem('mapleTimerSettings') || 'null');
    if (!settings) return;

    if (settings.mainDuration) {
        document.getElementById('timerDuration').value = settings.mainDuration;
        initializeCountdownDisplay();
    }
    if (settings.volume) {
        volumeControl.value = settings.volume;
        updateAllVolumes();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initializeCountdownDisplay();
    timerWorker = new Worker(workerUrl);
    document.querySelector('.input-group').addEventListener('click', () => {
        document.getElementById('timerDuration').focus();
    });
    loadSettings();
});

document.getElementById('timerDuration').addEventListener('input', () => {
    initializeCountdownDisplay();
    saveSettings();
});

// ===== 메인 타이머 =====
let startTime;
let specifiedDuration;

// 경과 초를 기준으로 현재 사이클 상태 계산 (Worker/rAF 공용)
function getCycleState(elapsedSeconds) {
    const cycleElapsedSeconds = elapsedSeconds % specifiedDuration;
    const isBoundary = cycleElapsedSeconds === 0 && elapsedSeconds !== 0;
    return { isBoundary, countdown: isBoundary ? 0 : specifiedDuration - cycleElapsedSeconds };
}

function startTimer() {
    specifiedDuration = readDuration();
    startTime = Date.now();
    initWebAudio();
    timerWorker.postMessage('start');

    // 백그라운드(Worker): 사이클 완료 알림음
    timerWorker.onmessage = function(e) {
        if (e.data !== 'tick') return;
        const state = getCycleState(Math.floor((Date.now() - startTime) / 1000));
        if (state.isBoundary) playSound(beepSound);
        countdownSeconds = state.countdown;
    };

    // 포그라운드(rAF): 표시/링 갱신
    function updateUI() {
        if (!animationId) return;
        const totalElapsedTimeMs = Date.now() - startTime;
        const currentTotalSeconds = Math.floor(totalElapsedTimeMs / 1000);
        const state = getCycleState(currentTotalSeconds);

        document.getElementById('timer').innerText = formatTime(currentTotalSeconds);
        document.getElementById('countdownTimer').innerText = formatTime(state.countdown);

        const durationMs = specifiedDuration * 1000;
        const remainingMs = durationMs - (totalElapsedTimeMs % durationMs);
        if (!ringFillAnimationId) setProgress((remainingMs / durationMs) * 100);

        // 링 색상 그라데이션 (노랑 → 주황 → 빨강)
        const t = 1 - (remainingMs / durationMs);
        const g = Math.round(204 - (127 * t));
        const b = Math.round(77 * t);
        circle.style.stroke = `rgb(255, ${g}, ${b})`;

        animationId = requestAnimationFrame(updateUI);
    }

    animationId = requestAnimationFrame(updateUI);
}
function stopTimer() {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    if (ringFillAnimationId) {
        cancelAnimationFrame(ringFillAnimationId); // 채우기 애니메이션 중단
        ringFillAnimationId = null;
    }
    if (timerWorker) timerWorker.postMessage('stop');
    clearInterval(randomSoundIntervalId);
    circle.style.stroke = '#ffcc00';
}

function toggleMainTimer() {
    const startButton = document.getElementById('start');
    if (!animationId) {
        startTimer();
        animateRingFill();
        startButton.classList.add('active');
        startButton.innerText = "RESET";
        randomSoundIntervalId = setInterval(playRandomBeep2to20, 20000);
        playSound(startSound);
    } else {
        stopTimer();
        initializeCountdownDisplay();
        document.getElementById('timer').innerText = '00:00';
        startButton.classList.remove('active');
        startButton.innerText = "START";
        playSound(resetSound);
    }
}

// 20초마다 브라우저를 깨우는 저음량 랜덤 비프
function playRandomBeep2to20() {
    randomSound.src = `sounds/beep${Math.floor(Math.random() * 3) + 1}.mp3`;
    randomSound.volume = (volumeControl.value / 100) * 0.05;
    randomSound.play()
        .then(() => setTimeout(() => {
            randomSound.pause();
            randomSound.currentTime = 0;
        }, 10))
        .catch(error => console.error("랜덤 비프음 재생 오류:", error));
}

document.getElementById('start').addEventListener('click', toggleMainTimer);

// ===== 키보드 =====
const ARROW_VOLUME = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5 };

function adjustVolume(delta) {
    const current = parseInt(volumeControl.value, 10) || 0;
    const newValue = Math.min(100, Math.max(0, current + delta));
    if (newValue === current) return; // 최소/최대 한계면 무시

    volumeControl.value = newValue;
    updateAllVolumes();
    saveSettings();
    showVolumeBubble();
    playVolumeFeedbackSound();
}

document.addEventListener('keydown', (e) => {
    // 텍스트 입력 필드에서는 단축키 비활성
    const activeElement = document.activeElement;
    const isTypingField = activeElement && (
        (activeElement.tagName === 'INPUT' && ['text', 'number', 'password', 'email', 'tel', 'url'].includes(activeElement.type)) ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable
    );
    if (isTypingField) return;

    // 방향키 볼륨 조절 (홀드 시 OS 반복 허용 → 연속 조절)
    if (ARROW_VOLUME[e.code] !== undefined) {
        e.preventDefault();
        adjustVolume(ARROW_VOLUME[e.code]);
        return;
    }

    // Space / Enter 타이머 토글 (홀드 반복 방지)
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        toggleMainTimer();
    }
});

document.getElementById('timerDuration').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('start').click();
    }
});

// 입력칸에 커서를 넣으면 리셋과 동일한 소리 재생
document.getElementById('timerDuration').addEventListener('focus', () => playSound(resetSound));

// ===== 볼륨 컨트롤 이벤트 =====
updateAllVolumes();
volumeControl.addEventListener('input', () => {
    updateAllVolumes();
    saveSettings();
    showVolumeBubble();
});
volumeControl.addEventListener('change', () => {
    volumeControl.blur(); // 조절 완료 시 포커스 해제
    showVolumeBubble();
    playVolumeFeedbackSound();
});
volumeControl.addEventListener('mousedown', () => setTimeout(() => volumeControl.blur(), 0));