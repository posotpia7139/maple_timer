let countdownSeconds = 0;
let animationId;
let randomSoundIntervalId;
let timerWorker;
let lastVolumeFeedbackSoundTime = 0; // 볼륨 조절 피드백음 1.5초 이내 반복 방지용

// Web Worker를 문자열로 생성 (별도 파일 없이 사용 가능)
const workerCode = `
    let timerId = null;
    self.onmessage = function(e) {
        if (e.data === 'start') {
            if (timerId) clearInterval(timerId);
            timerId = setInterval(() => {
                self.postMessage('tick');
            }, 100);
        } else if (e.data === 'stop') {
            clearInterval(timerId);
            timerId = null;
        }
    };
`;

const blob = new Blob([workerCode], { type: 'application/javascript' });
const workerUrl = URL.createObjectURL(blob);

const circle = document.querySelector('.ring-progress');
const radius = circle.r.baseVal.value;
const circumference = 2 * Math.PI * radius;

circle.style.strokeDasharray = `${circumference} ${circumference}`;
circle.style.strokeDashoffset = circumference;

function setProgress(percent) {
    const offset = circumference - (percent / 100 * circumference);
    circle.style.strokeDashoffset = offset;
}

// START 시 노란 원을 일정한 속도로 채우는 애니메이션
let ringFillAnimationId = null;
const RING_FILL_DURATION_MS = 267;

function animateRingFill() {
    if (ringFillAnimationId) {
        cancelAnimationFrame(ringFillAnimationId);
        ringFillAnimationId = null;
    }

    setProgress(0);
    const start = performance.now();

    function frame(now) {
        const t = Math.min(1, (now - start) / RING_FILL_DURATION_MS);

        // 일정한 속도로 채우기 (선형, 탄력 효과 없음)
        setProgress(t * 100);

        if (t < 1) {
            ringFillAnimationId = requestAnimationFrame(frame);
        } else {
            ringFillAnimationId = null;
        }
    }

    ringFillAnimationId = requestAnimationFrame(frame);
}

const startSound = new Audio('sounds/start.mp3');
const resetSound = new Audio('sounds/reset.mp3');
const beepSound = new Audio('sounds/beep.mp3');
// const silentSound = new Audio('silent.mp3'); // 백그라운드 유지를 위한 무음 사운드 (미사용)
// silentSound.loop = true;

// Web Audio API를 이용한 백그라운드 유지 로직
let audioCtx = null;

function initWebAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// 20초마다 브라우저를 깨우기 위한 짧은 무음 펄스
function playSilentPulse() {
    if (!audioCtx) return;
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    // 사용자는 못 듣지만 브라우저는 인식하는 초미세 볼륨
    gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.1);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1); // 0.1초 후 즉시 정지
}

// Page Visibility API: 탭 상태 변화 감지
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && animationId) {
        // 탭으로 돌아왔을 때 오디오 컨텍스트가 정지되어 있다면 재개
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }
});

const volumeControl = document.getElementById('volumeControl');
const volumeIcon = document.getElementById('volumeIcon');
const volumeBubble = document.getElementById('volumeBubble');
let volumeBubbleHideTimeoutId = null;
const VOLUME_BUBBLE_SHOW_MS = 1500; // 볼륨 말풍선 표시 유지 시간 (마지막 조절 후 1.5초 뒤 페이드 아웃)

// 모든 사운드의 볼륨을 한 번에 설정하는 함수
function updateAllVolumes() {
    const value = parseInt(volumeControl.value, 10);
    const volume = value / 100;
    
    beepSound.volume = volume;
    startSound.volume = volume;
    resetSound.volume = volume;
    // silentSound.volume = 0.01; // 아주 작게 설정하여 연결 유지

    // 볼륨이 0이면 음소거 아이콘으로 변경
    if (value === 0) {
        volumeIcon.innerText = '🔇';
    } else {
        volumeIcon.innerText = '🔊';
    }
}

// 볼륨 퍼센트 말풍선 표시 (슬라이더 핸들 위에, 마지막 조절 후 약 1.5초 뒤 페이드 아웃)
function showVolumeBubble() {
    const value = parseInt(volumeControl.value, 10) || 0;
    volumeBubble.innerText = value + '%';

    // 슬라이더 트랙 기준 핸들 위치(X)를 계산해 말풍선을 그 위에 정렬
    const sliderRect = volumeControl.getBoundingClientRect();
    const percent = value / 100;
    const handleX = sliderRect.left + sliderRect.width * percent;
    volumeBubble.style.left = handleX + 'px';
    volumeBubble.style.top = (sliderRect.top - 10) + 'px'; // 말풍선 하단이 핸들 위 10px

    volumeBubble.classList.add('show');

    // 조절할 때마다 타이머 리셋 → 마지막 조절 후 약 1.5초 뒤 사라짐
    clearTimeout(volumeBubbleHideTimeoutId);
    volumeBubbleHideTimeoutId = setTimeout(() => {
        volumeBubble.classList.remove('show');
    }, VOLUME_BUBBLE_SHOW_MS);
}

// 볼륨 조절 피드백음 (실제 알람음과는 별개).
// 마지막 재생 후 1.5초 이내에는 반복 재생되지 않도록 쿨다운 처리.
const VOLUME_FEEDBACK_MIN_INTERVAL_MS = 1500;
function playVolumeFeedbackSound() {
    const now = Date.now();
    if (now - lastVolumeFeedbackSoundTime < VOLUME_FEEDBACK_MIN_INTERVAL_MS) return;
    lastVolumeFeedbackSoundTime = now;
    playRandomBeep();
}

// 랜덤 비프음 재생
function playRandomBeep2to20() {
    const randomNumber = Math.floor(Math.random() * 3) + 1;
    const randomSound = new Audio(`sounds/beep${randomNumber}.mp3`);
    randomSound.volume = (volumeControl.value / 100) * 0.05; 
    randomSound.play()
        .then(() => {
            // 0.01초(10ms) 후에 재생 중지
            setTimeout(() => {
                randomSound.pause();
                randomSound.currentTime = 0;
            }, 10);
        })
        .catch(error => console.error("랜덤 비프음 재생 오류:", error));
}

updateAllVolumes();
// 볼륨 조절 및 포커스 관리
volumeControl.addEventListener('input', () => {
    // 드래그 중에는 소리를 내지 않음(여러 번 중복 출력 방지).
    // 볼륨 값만 실시간 반영한다.
    updateAllVolumes();
    saveSettings();
    showVolumeBubble();
});
volumeControl.addEventListener('change', () => {
    volumeControl.blur(); // 조절 완료 시 포커스 해제
    showVolumeBubble();

    // 드래그 종료 시 피드백음 재생 (1.5초 이내 반복 방지)
    playVolumeFeedbackSound();
});
volumeControl.addEventListener('mousedown', () => {
    // 클릭하는 순간 포커스 테두리가 생기지 않도록 blur 처리 (약간의 지연 필요)
    setTimeout(() => volumeControl.blur(), 0);
});

function initializeCountdownDisplay() {
    const durationInput = document.getElementById('timerDuration');
    const specifiedDuration = parseInt(durationInput.value, 10) || 100;
    countdownSeconds = specifiedDuration;
    updateCountdownDisplay();
    setProgress(0); // 시작 전/리셋 후에는 노란 원을 비워 둔다
}

// 설정 저장 함수
function saveSettings() {
    const settings = {
        mainDuration: document.getElementById('timerDuration').value,
        volume: volumeControl.value
    };
    localStorage.setItem('mapleTimerSettings', JSON.stringify(settings));
}

// 설정 불러오기 함수
function loadSettings() {
    const saved = localStorage.getItem('mapleTimerSettings');
    if (!saved) return;

    const settings = JSON.parse(saved);
    
    // 메인 설정 복원
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

    // 설정 불러오기
    loadSettings();
});

// 메인 설정 변경 시 저장 연결
document.getElementById('timerDuration').addEventListener('input', () => {
    initializeCountdownDisplay();
    saveSettings();
});

let startTime;
let specifiedDuration;
let lastLoggedSecond = -1;
let isWarningState = false;

let pulseTickCounter = 0; // 20초 펄스를 위한 카운터

function startTimer() {
    const durationInput = document.getElementById('timerDuration');
    specifiedDuration = parseInt(durationInput.value, 10) || 100;
    startTime = Date.now();
    lastLoggedSecond = -1;
    isWarningState = false;
    pulseTickCounter = 0; // 카운터 초기화

    // silentSound.play().catch(e => console.error(e));
    initWebAudio(); // Web Audio API 준비 (재생은 안 함)
    timerWorker.postMessage('start');
    
    timerWorker.onmessage = function(e) {
        if (e.data === 'tick') {
            const totalElapsedTimeMs = Date.now() - startTime;
            const currentTotalSeconds = Math.floor(totalElapsedTimeMs / 1000);

            // 20초마다 무음 펄스 재생 (비활성화됨)
            pulseTickCounter++;
            /*
            if (pulseTickCounter >= 200) {
                playSilentPulse();
                pulseTickCounter = 0;
            }
            */

            if (currentTotalSeconds !== lastLoggedSecond) {
                const cycleElapsedSeconds = currentTotalSeconds % specifiedDuration;
                countdownSeconds = (cycleElapsedSeconds === 0 && currentTotalSeconds !== 0) ? 0 : specifiedDuration - cycleElapsedSeconds;
                
                if (cycleElapsedSeconds === 0 && currentTotalSeconds !== 0) {
                    playRandomBeep();
                }

                lastLoggedSecond = currentTotalSeconds;
            }
        }
    };

    function updateUI() {
        if (!animationId) return;

        const totalElapsedTimeMs = Date.now() - startTime;
        const currentTotalSeconds = Math.floor(totalElapsedTimeMs / 1000);
        
        const elapsedMinutes = Math.floor(currentTotalSeconds / 60);
        const elapsedSecs = currentTotalSeconds % 60;
        document.getElementById('timer').innerText = `${String(elapsedMinutes).padStart(2, '0')}:${String(elapsedSecs).padStart(2, '0')}`;

        const cycleElapsedSeconds = currentTotalSeconds % specifiedDuration;
        const displayCountdown = (cycleElapsedSeconds === 0 && currentTotalSeconds !== 0) ? 0 : specifiedDuration - cycleElapsedSeconds;
        
        const countdownTimerDisplay = document.getElementById('countdownTimer');
        const minutes = Math.floor(displayCountdown / 60);
        const countdownSecs = displayCountdown % 60;
        countdownTimerDisplay.innerText = `${String(minutes).padStart(2, '0')}:${String(countdownSecs).padStart(2, '0')}`;

        const durationMs = specifiedDuration * 1000;
        const msIntoCurrentCycle = totalElapsedTimeMs % durationMs;
        const remainingMs = durationMs - msIntoCurrentCycle;
        const smoothPercent = (remainingMs / durationMs) * 100;
        
        // START 직후 탄력 채우기 애니메이션 중에는 링을 그쪽이 그리도록 넘긴다
        if (!ringFillAnimationId) setProgress(smoothPercent);

        const t = 1 - (remainingMs / durationMs);
        const r = 255;
        const g = Math.round(204 - (127 * t));
        const b = Math.round(77 * t);
        circle.style.stroke = `rgb(${r}, ${g}, ${b})`;

        animationId = requestAnimationFrame(updateUI);
    }

    animationId = requestAnimationFrame(updateUI);
}

function stopTimer() {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    // 채우기 애니메이션 중이었다면 중단
    if (ringFillAnimationId) {
        cancelAnimationFrame(ringFillAnimationId);
        ringFillAnimationId = null;
    }
    if (timerWorker) {
        timerWorker.postMessage('stop');
    }
    clearInterval(randomSoundIntervalId);
    // silentSound.pause();
    // silentSound.currentTime = 0;
    // stopWebAudio(); // 이제 지속 재생이 아니므로 호출 불필요
    
    isWarningState = false;
    circle.style.stroke = '#ffcc00';
}

function toggleMainTimer() {
    const startButton = document.getElementById('start');
    if (!animationId) {
        startTimer();
        animateRingFill(); // 노란 원 탄력 배지어 채우기 애니메이션
        startButton.classList.add('active');
        startButton.innerText = "RESET";
        randomSoundIntervalId = setInterval(playRandomBeep2to20, 20000);
        startSound.currentTime = 0;
        startSound.play().catch(e => console.error(e));
    } else {
        stopTimer();
        initializeCountdownDisplay();
        document.getElementById('timer').innerText = '00:00';
        startButton.classList.remove('active');
        startButton.innerText = "START";
        resetSound.currentTime = 0;
        resetSound.play().catch(e => console.error(e));
    }
}

function updateCountdownDisplay() {
    const countdownTimerDisplay = document.getElementById('countdownTimer');
    const minutes = Math.floor(countdownSeconds / 60);
    const secs = countdownSeconds % 60;
    countdownTimerDisplay.innerText = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function playRandomBeep() {
    beepSound.currentTime = 0;
    beepSound.play().catch(error => console.error("비프 소리 재생 오류:", error));
}

document.getElementById('start').addEventListener('click', toggleMainTimer);

// 방향키로 볼륨 조절 (1회 누름 = 5%씩)
function adjustVolume(delta) {
    const current = parseInt(volumeControl.value, 10) || 0;
    const newValue = Math.min(100, Math.max(0, current + delta));
    if (newValue === current) return; // 최소/최대 한계라 변경 없으면 무시

    volumeControl.value = newValue;
    updateAllVolumes();
    saveSettings();
    showVolumeBubble();

    // 키보드 조절 시에도 피드백음 재생 (1.5초 이내 반복 방지)
    playVolumeFeedbackSound();
}

document.addEventListener('keydown', (e) => {
    const activeElement = document.activeElement;
    // 텍스트를 입력하는 필드인지 더 정확하게 판별 (range, checkbox 등은 제외)
    const isTypingField = activeElement && (
        (activeElement.tagName === 'INPUT' && ['text', 'number', 'password', 'email', 'tel', 'url'].includes(activeElement.type)) ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.isContentEditable
    );

    if (isTypingField) return;

    // 방향키 볼륨 조절: 좌/아래 = 낮추기, 우/위 = 높이기
    // 꾹 누르면 OS 키 반복(e.repeat)을 허용해 연속으로 조절
    if (e.code === 'ArrowUp' || e.code === 'ArrowRight') {
        e.preventDefault();
        adjustVolume(5);
        return;
    }
    if (e.code === 'ArrowDown' || e.code === 'ArrowLeft') {
        e.preventDefault();
        adjustVolume(-5);
        return;
    }

    // Space / Enter 타이머 토글은 홀드 반복 방지 (단발 동작 유지)
    if (e.repeat) return;

    if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'NumpadEnter') return;

    e.preventDefault();
    toggleMainTimer();
});

document.getElementById('timerDuration').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('start').click();
    }
});

// 타이머 시간 입력칸에 커서를 넣으면(클릭/포커스) 리셋 버튼과 동일한 소리 재생
document.getElementById('timerDuration').addEventListener('focus', () => {
    resetSound.currentTime = 0;
    resetSound.play().catch(error => console.error("리셋 소리 재생 오류:", error));
});
