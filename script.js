let countdownSeconds = 0;
let animationId;
let randomSoundIntervalId;
let timerWorker;

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

const circle = document.querySelector('.progress-ring__circle');
const radius = circle.r.baseVal.value;
const circumference = 2 * Math.PI * radius;

circle.style.strokeDasharray = `${circumference} ${circumference}`;
circle.style.strokeDashoffset = circumference;

function setProgress(percent) {
    const offset = circumference - (percent / 100 * circumference);
    circle.style.strokeDashoffset = offset;
}

const startSound = new Audio('start.mp3');
const resetSound = new Audio('reset.mp3');
const beepSound = new Audio('beep.mp3');
const silentSound = new Audio('silent.mp3'); // 백그라운드 유지를 위한 무음 사운드
silentSound.loop = true;

const volumeControl = document.getElementById('volumeControl');
const volumeIcon = document.getElementById('volumeIcon');

// 모든 사운드의 볼륨을 한 번에 설정하는 함수
function updateAllVolumes() {
    const value = parseInt(volumeControl.value, 10);
    const volume = value / 100;
    
    beepSound.volume = volume;
    startSound.volume = volume;
    resetSound.volume = volume;
    silentSound.volume = 0.01; // 아주 작게 설정하여 연결 유지

    // 볼륨이 0이면 음소거 아이콘으로 변경
    if (value === 0) {
        volumeIcon.innerText = '🔇';
    } else {
        volumeIcon.innerText = '🔊';
    }
}

// 랜덤 비프음 재생
function playRandomBeep2to20() {
    const randomNumber = Math.floor(Math.random() * 3) + 1;
    const randomSound = new Audio(`sounds/beep${randomNumber}.mp3`);
    randomSound.volume = (volumeControl.value / 100) * 0.05; 
    randomSound.play().catch(error => console.error("랜덤 비프음 재생 오류:", error));
}

updateAllVolumes();
volumeControl.addEventListener('input', updateAllVolumes);

function initializeCountdownDisplay() {
    const durationInput = document.getElementById('timerDuration');
    const specifiedDuration = parseInt(durationInput.value, 10) || 100;
    countdownSeconds = specifiedDuration;
    updateCountdownDisplay();
    setProgress(100);
}

// 보조 타이머 객체 리스트
let miniTimers = [];

// 설정 저장 함수
function saveSettings() {
    const settings = {
        mainDuration: document.getElementById('timerDuration').value,
        volume: volumeControl.value,
        miniTimers: miniTimers.map(t => ({
            duration: t.input.value,
            active: t.toggle.checked
        }))
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

    // 보조 타이머 복원
    if (settings.miniTimers && settings.miniTimers.length > 0) {
        const list = document.getElementById('miniTimersList');
        list.innerHTML = '';
        miniTimers = [];
        
        settings.miniTimers.forEach(data => {
            createMiniTimerRow(data.duration, data.active);
        });
    }
}

function createMiniTimerRow(defaultDuration = 60, defaultActive = true) {
    const timerId = Date.now() + Math.random();
    const row = document.createElement('div');
    row.className = `mini-timer-row ${defaultActive ? '' : 'inactive'}`;
    row.id = `timer-${timerId}`;
    row.innerHTML = `
        <label class="mini-switch">
            <input type="checkbox" class="mini-toggle" ${defaultActive ? 'checked' : ''}>
            <span class="slider"></span>
        </label>
        <div class="mini-display">01:00</div>
        <div class="mini-input-group">
            <input type="number" class="mini-timer-input" value="${defaultDuration}" min="1" ${defaultActive ? '' : 'disabled'}>
            <span class="mini-unit">SEC</span>
        </div>
        <button class="remove-mini-btn" title="삭제">×</button>
    `;

    const timerObj = {
        id: timerId,
        element: row,
        remainingSeconds: parseInt(defaultDuration, 10),
        intervalId: null,
        get toggle() { return row.querySelector('.mini-toggle'); },
        get input() { return row.querySelector('.mini-timer-input'); },
        get display() { return row.querySelector('.mini-display'); }
    };

    // 토글 이벤트
    timerObj.toggle.addEventListener('change', () => {
        const isActive = timerObj.toggle.checked;
        timerObj.input.disabled = !isActive;
        row.classList.toggle('inactive', !isActive);
        if (!isActive) stopSingleMiniTimer(timerObj);
        saveSettings();
    });

    // 입력 이벤트
    timerObj.input.addEventListener('input', () => {
        if (!animationId) {
            timerObj.remainingSeconds = parseInt(timerObj.input.value, 10) || 0;
            updateSingleMiniDisplay(timerObj);
        }
        saveSettings();
    });

    // 삭제 이벤트
    row.querySelector('.remove-mini-btn').addEventListener('click', () => {
        stopSingleMiniTimer(timerObj);
        row.remove();
        miniTimers = miniTimers.filter(t => t.id !== timerId);
        saveSettings();
    });

    document.getElementById('miniTimersList').appendChild(row);
    miniTimers.push(timerObj);
    updateSingleMiniDisplay(timerObj);
}

function updateSingleMiniDisplay(timer) {
    const minutes = Math.floor(timer.remainingSeconds / 60);
    const secs = timer.remainingSeconds % 60;
    timer.display.innerText = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function playMiniAlarm() {
    const miniAlarm = beepSound.cloneNode();
    const currentVolume = (parseInt(volumeControl.value, 10) || 0) / 100;
    miniAlarm.volume = currentVolume * 0.8;
    miniAlarm.play().catch(error => console.error("미니 알람 재생 오류:", error));

    setTimeout(() => {
        miniAlarm.pause();
        miniAlarm.currentTime = 0;
    }, 500);
}

function startAllMiniTimers() {
    miniTimers.forEach(timer => {
        if (!timer.toggle.checked) return;

        const totalSeconds = parseInt(timer.input.value, 10) || 60;
        timer.remainingSeconds = totalSeconds;
        updateSingleMiniDisplay(timer);

        if (timer.intervalId) clearInterval(timer.intervalId);
        timer.intervalId = setInterval(() => {
            if (timer.remainingSeconds > 0) {
                timer.remainingSeconds--;
                updateSingleMiniDisplay(timer);
                
                if (timer.remainingSeconds === 0) {
                    playMiniAlarm();
                    timer.remainingSeconds = totalSeconds;
                }
            }
        }, 1000);
    });
}

function stopAllMiniTimers() {
    miniTimers.forEach(timer => stopSingleMiniTimer(timer));
}

function stopSingleMiniTimer(timer) {
    if (timer.intervalId) {
        clearInterval(timer.intervalId);
        timer.intervalId = null;
    }
    timer.remainingSeconds = parseInt(timer.input.value, 10) || 60;
    updateSingleMiniDisplay(timer);
}

document.addEventListener('DOMContentLoaded', () => {
    initializeCountdownDisplay();
    timerWorker = new Worker(workerUrl);
    
    document.querySelector('.input-group').addEventListener('click', () => {
        document.getElementById('timerDuration').focus();
    });

    // 추가 버튼 이벤트
    document.getElementById('addMiniTimer').addEventListener('click', () => {
        createMiniTimerRow();
        saveSettings();
    });

    // 설정 불러오기
    loadSettings();
});

// 메인 설정 변경 시 저장 연결
document.getElementById('timerDuration').addEventListener('input', () => {
    initializeCountdownDisplay();
    saveSettings();
});
volumeControl.addEventListener('input', () => {
    updateAllVolumes();
    saveSettings();
});

let startTime;
let specifiedDuration;
let lastLoggedSecond = -1;
let isWarningState = false;

function startTimer() {
    const durationInput = document.getElementById('timerDuration');
    specifiedDuration = parseInt(durationInput.value, 10) || 100;
    startTime = Date.now();
    lastLoggedSecond = -1;
    isWarningState = false;

    silentSound.play().catch(e => console.error(e));
    timerWorker.postMessage('start');
    
    timerWorker.onmessage = function(e) {
        if (e.data === 'tick') {
            const totalElapsedTimeMs = Date.now() - startTime;
            const currentTotalSeconds = Math.floor(totalElapsedTimeMs / 1000);

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
        
        setProgress(smoothPercent);

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
    if (timerWorker) {
        timerWorker.postMessage('stop');
    }
    clearInterval(randomSoundIntervalId);
    silentSound.pause();
    silentSound.currentTime = 0;
    
    isWarningState = false;
    circle.style.stroke = '#ffcc00';
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

document.getElementById('start').addEventListener('click', () => {
    const startButton = document.getElementById('start');
    if (!animationId) {
        startTimer();
        startAllMiniTimers();
        startButton.classList.add('active');
        startButton.innerText = "RESET";
        randomSoundIntervalId = setInterval(playRandomBeep2to20, 20000);
        startSound.currentTime = 0;
        startSound.play().catch(e => console.error(e));
    } else {
        stopTimer();
        stopAllMiniTimers();
        initializeCountdownDisplay();
        document.getElementById('timer').innerText = '00:00';
        startButton.classList.remove('active');
        startButton.innerText = "START";
        resetSound.currentTime = 0;
        resetSound.play().catch(e => console.error(e));
    }
});

document.getElementById('timerDuration').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('start').click();
    }
});
