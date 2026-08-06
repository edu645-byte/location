/**
 * ==========================================================================
 * AI 실시간 GPS 동선 이탈 및 위험구역 침범 감지 통제소 코어 엔진 (002_path_analyzer.js)
 * ==========================================================================
 * - 작성 목적: 외부 기하 라이브러리 없이 '순수 자바스크립트 기하 연산'만으로 100% 동작하는 AI 경로 분석기 구현
 * - 핵심 탑재 알고리즘:
 *   1. [Haversine 공식] 지구 구면 좌표계(위도, 경도) 간의 미터(m) 단위 실시간 최단 거리 연산
 *   2. [선분과 점 사이의 거리 알고리즘] 정상 경로(선분 배열)와 현재 위치(점) 사이의 실시간 실거리(m) 이탈 감지
 *   3. [Ray-Casting 알고리즘] 임의 다각형(Polygon) 위험 구역 내부에 현재 위치가 포함되는지(Point-in-Polygon) 자동 판정
 *   4. [가상 궤적 인터랙티브 재생기] 송정역 인근 실제 지도 도로망을 바탕으로 정상 주행 -> 이탈 -> 위험구역 침범 전 과정을 시각화
 * ==========================================================================
 */

// --- [1. 전역 상태 변수] ---
let map;                        // Leaflet 지도 인스턴스
let deviceMarker;               // 대상자(기기)의 실시간 위치를 표시하는 마커 핀
let pathLine;                   // 대상자가 그동안 이동해 온 발자취 경로 선 (실시간 궤적)
let simulationInterval = null;  // 시뮬레이션 인터벌 타이머
let isSimulating = false;       // 시뮬레이션이 돌아가고 있는지 여부
let currentStepIdx = 0;         // 시뮬레이션 주행 한걸음 단계 인덱스
let elapsedSeconds = 0;         // 가상 누적 주행 시간(초)

// --- [2. 분석용 가상 지도 구역 모델링 데이터 정의] ---

// A. 정상 이동 경로 정의 (송정공원역 인근 인도/골목 안전 루트 선분 노드들)
const safePathNodes = [
    [35.1376, 126.7909], // 노드 0: 송정역 광장 초입 (출발점)
    [35.1388, 126.7915], // 노드 1: 삼거리 교차로 인도
    [35.1396, 126.7925], // 노드 2: 골목 삼거리 초입
    [35.1408, 126.7938], // 노드 3: 송정공원 인근 안전 도보 골목
    [35.1415, 126.7950], // 노드 4: 송정 도서관 뒤편 주차구역 인도 (정상 도달 골라인)
];

// B. 위험 구역 1 (다각형 - 야산 험로 및 추락 위험 절벽 지구)
const dangerPolygonCoords = [
    [35.1420, 126.7955], // 다각형 우상단
    [35.1410, 126.7965], // 다각형 우하단
    [35.1395, 126.7950], // 다각형 좌하단
    [35.1408, 126.7942]  // 다각형 좌상단
];

// C. 위험 구역 2 (원형 - 깊은 맨홀 및 실시간 도로 아스팔트 공사 가상 싱크홀 구역)
const dangerCircleCenter = [35.1385, 126.7935];
const dangerCircleRadiusMeter = 35; // 반경 35미터 이내는 낭떠러지 위험 공사구역으로 선포

// D. 실시간 시뮬레이션용 가상 동선 주행 시나리오 궤적 데이터
// (정상 루트를 잘 따르다가 6번째 스텝부터 갑자기 이탈을 시작하여 위험 구역 2를 스친 뒤 위험 다각형 1 내부로 들어가 헤매는 시나리오)
const simulatedTrajectory = [
    { lat: 35.1376, lng: 126.7909 }, // 0. 송정역 광장 출발 (안전 상태)
    { lat: 35.1382, lng: 126.7912 }, // 1. 정상 이동 중
    { lat: 35.1388, lng: 126.7915 }, // 2. 정상 노드 1 도달
    { lat: 35.1392, lng: 126.7920 }, // 3. 정상 이동 중
    { lat: 35.1396, lng: 126.7925 }, // 4. 정상 노드 2 도달
    { lat: 35.1392, lng: 126.7931 }, // 5. 갑자기 골목길을 벗어나 공사구역 방향으로 살짝 이탈 시작
    { lat: 35.1386, lng: 126.7934 }, // 6. [위험원 근접] 공사구역 원 바운더리 35m 범위에 아슬아슬하게 스쳐 지나감 (이탈 경보 활성화!)
    { lat: 35.1401, lng: 126.7945 }, // 7. 우측 야산 방향으로 완전히 헤매기 시작함 (안전 통로 이탈 누적 거리가 대폭 늘어남)
    { lat: 35.1409, lng: 126.7947 }, // 8. 야산 초입 우거진 수풀 진입 (정상로와 60m 이탈)
    { lat: 35.1411, lng: 126.7953 }, // 9. [비상사태!] 급경사 절벽 위험 다각형 구역 내부 깊숙이 들어와 길을 완전히 잃음 (위험진입 비상음 가동!)
    { lat: 35.1415, lng: 126.7958 }, // 10. 다각형 펜스 안을 헤매며 패닉에 빠짐 (보호자에게 실시간 SOS 및 인코딩 데이터 발송됨)
    { lat: 35.1413, lng: 126.7954 }  // 11. 최종 조난 정차 (가상 추적 종료)
];

// --- [3. 엔진 구동 및 지도 초기화] ---
document.addEventListener("DOMContentLoaded", () => {
    initLeafletControlMap();  // 관제 전용 지도 생성
    registerControlEvents();  // 버튼 조작 제어판 연동
    resetSmsPayloadText();    // SOS 텍스트아레아 디폴트 데이터 세팅
});

function initLeafletControlMap() {
    // 송정역 인근이 한눈에 보이는 최적의 카메라 줌 높이로 시작 설정
    map = L.map("map", {
        zoomControl: false
    }).setView([35.1395, 126.7935], 16);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // 고급스러운 흑무채색 다크 맵 타일 수록
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CartoDB',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    // --- [지도 상에 통제 구역 시각화 렌더링하기] ---

    // 1. 정상 도보 인도 경로 (세련된 네온 그린 점선 폴리라인 스타일링)
    L.polyline(safePathNodes, {
        color: '#10b981',
        weight: 6,
        opacity: 0.8,
        dashArray: '10, 15', // 점선 가시화
        lineCap: 'round'
    }).addTo(map).bindPopup("<strong style='color:#10b981;'>지정 안전 권장 인도</strong><br>대상자가 이탈 없이 걸어야 할 안전 골목길 라인입니다.");

    // 2. 위험 구역 1 다각형 (붉은 네온빛 다각형 펜스 칠하기)
    L.polygon(dangerPolygonCoords, {
        color: '#ef4444',
        weight: 2,
        fillColor: '#ef4444',
        fillOpacity: 0.2,
        dashArray: '5, 5'
    }).addTo(map).bindPopup("<strong style='color:#ef4444;'>⚠️ 야산 급경사 절벽 추락지역</strong><br>미인가 등산로로 출입 통제 펜스가 쳐진 위험 구역입니다.");

    // 3. 위험 구역 2 원형 (붉은 세련된 원 펜스 칠하기)
    L.circle(dangerCircleCenter, {
        radius: dangerCircleRadiusMeter,
        color: '#ef4444',
        weight: 2,
        fillColor: '#f59e0b', // 공사중 무드를 위해 옐로우-오렌지 필 조합
        fillOpacity: 0.15
    }).addTo(map).bindPopup("<strong style='color:#ef4444;'>🚧 정밀 아스팔트 교체 공사장 (싱크홀 경고)</strong><br>안전 통행 제어로 진입이 차단된 기동 공사 지역입니다.");

    // 지도 클릭 시 수동 시뮬레이션 검출 기능 (원하시는 지점을 마음대로 찍어서 AI 판정 테스트)
    map.on("click", (e) => {
        if (isSimulating) {
            alert("가상 동선 시뮬레이션이 활발히 구동 중일 때는 수동 지점 찍기가 제한됩니다. 먼저 시뮬레이션을 정지 또는 초기화해 주세요!");
            return;
        }
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        processGeoAiAnalysis(lat, lng);
    });
}

// --- [4. 수동 제어반 버튼 조작 핸들러] ---
function registerControlEvents() {
    const btnToggle = document.getElementById("btn-toggle-simulation");
    const btnReset = document.getElementById("btn-reset-simulation");

    btnToggle.addEventListener("click", () => {
        if (isSimulating) {
            // 정지 모드로 전환
            stopSimulation();
        } else {
            // 시작 모드로 전환
            startSimulation();
        }
    });

    btnReset.addEventListener("click", () => {
        resetSimulationState();
    });
}

function startSimulation() {
    isSimulating = true;
    const btnToggle = document.getElementById("btn-toggle-simulation");
    btnToggle.innerHTML = `<i class="ri-pause-fill"></i> 가상 수색 일시정지`;
    btnToggle.style.background = "linear-gradient(135deg, var(--warning) 0%, #d97706 100%)";
    btnToggle.style.boxShadow = "0 4px 12px rgba(245, 158, 11, 0.3)";

    console.log("🚀 GPS 실시간 경로 분석 AI 시뮬레이터 가동 시작");

    // 이미 마지막 스텝까지 다 돌고 멈춰있다가 다시 누를 경우 자동으로 처음부터 주행하게 리셋 연동
    if (currentStepIdx >= simulatedTrajectory.length) {
        currentStepIdx = 0;
        elapsedSeconds = 0;
        if (pathLine) {
            pathLine.setLatLngs([]);
        }
    }

    simulationInterval = setInterval(() => {
        if (currentStepIdx < simulatedTrajectory.length) {
            const currentPoint = simulatedTrajectory[currentStepIdx];
            processGeoAiAnalysis(currentPoint.lat, currentPoint.lng);
            
            // 실시간 주행 궤적 그리기 누적
            if (pathLine) {
                pathLine.addLatLng([currentPoint.lat, currentPoint.lng]);
            } else {
                pathLine = L.polyline([[currentPoint.lat, currentPoint.lng]], {
                    color: '#c084fc', // 퍼플 동선 트래커
                    weight: 4,
                    opacity: 0.9
                }).addTo(map);
            }

            currentStepIdx++;
            elapsedSeconds += 3; // 한 걸음 주행할 때마다 실제 3초씩 흘러가는 타임 시퀀스 스펙 부여
            updateTimeDisplay();
        } else {
            // 코스를 무사히 완주하면 자동 정지
            stopSimulation();
            alert("🏁 준비된 시나리오 주행 궤적이 모두 마감되었습니다. 좌측 분석기의 융합 SOS 문자 생성 페이로드를 확인해 보세요!");
        }
    }, 1500); // 1.5초마다 가상 사용자가 한 스텝씩 전진
}

function stopSimulation() {
    isSimulating = false;
    clearInterval(simulationInterval);
    const btnToggle = document.getElementById("btn-toggle-simulation");
    btnToggle.innerHTML = `<i class="ri-play-fill"></i> 가상 이동 수색 시뮬레이션 시작`;
    btnToggle.style.background = "linear-gradient(135deg, var(--accent) 0%, #7c3aed 100%)";
    btnToggle.style.boxShadow = "0 4px 12px rgba(139, 92, 246, 0.3)";
}

function resetSimulationState() {
    stopSimulation();
    currentStepIdx = 0;
    elapsedSeconds = 0;
    updateTimeDisplay();

    // 동선 흔적 삭제
    if (pathLine) {
        map.removeLayer(pathLine);
        pathLine = null;
    }
    // 마커 삭제
    if (deviceMarker) {
        map.removeLayer(deviceMarker);
        deviceMarker = null;
    }

    // 통제판 리셋
    resetSmsPayloadText();
    updatePanelUI("safe", 0, "안전구역 체류");
}

function updateTimeDisplay() {
    const min = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
    const sec = String(elapsedSeconds % 60).padStart(2, "0");
    document.getElementById("meter-time").innerText = `${min}분 ${sec}초`;
}

// --- [5. 공간 기하 분석 AI 추론 코어 함수 (가장 중요한 부분) ★] ---
function processGeoAiAnalysis(lat, lng) {
    // 1. 수치 미터 정보에 가상 기기의 현재 위도/경도를 실시간 기입
    document.getElementById("meter-coords").innerText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    // 2. 지도 위 대상자 핀 갱신
    updateDeviceMarker(lat, lng);

    // --- [알고리즘 1] 선분 배열(정상 안전 인도)로부터 현재 좌표점까지의 최단 이탈 거리 연산 ---
    const deviationDistance = calculateMinDistanceToPath(lat, lng, safePathNodes);
    document.getElementById("meter-distance").innerText = `${deviationDistance.toFixed(2)} m`;

    // --- [알고리즘 2] 원형 펜스(공사 구역) 침범 여부 체크 (하버사인 구면 중심 거리 비교) ---
    const distanceToCircleCenter = getHaversineDistanceMeter(lat, lng, dangerCircleCenter[0], dangerCircleCenter[1]);
    const insideDangerCircle = distanceToCircleCenter <= dangerCircleRadiusMeter;

    // --- [알고리즘 3] 다각형(야산 절벽) 침범 여부 판정 (Ray-Casting Point-in-Polygon) ---
    const insideDangerPolygon = checkPointInPolygon(lat, lng, dangerPolygonCoords);

    // 3. 수치 연산 종합하여 AI 통합 상태 판정 및 통제소 경보 격상 조절
    let finalState = "safe";
    let zoneText = "안전 구역 체류";

    if (insideDangerPolygon) {
        finalState = "danger";
        zoneText = "🚨 험난한 야산지대 침범!";
    } else if (insideDangerCircle) {
        finalState = "warn";
        zoneText = "⚠️ 정밀 공사 구역 근접!";
    } else if (deviationDistance > 30) {
        // 안전 정상 궤도에서 30미터 이상 일탈한 경우 자동 이탈 상태로 규정
        finalState = "warn";
        zoneText = "⚠️ 골목길 이탈 상태";
    }

    document.getElementById("meter-danger-zone").innerText = zoneText;

    // 실시간 상태 통제판 칼라링 및 SOS 페이로드 실시간 오토 빌딩 가동
    updatePanelUI(finalState, deviationDistance, zoneText, lat, lng);
}

// 지도 위 탐지 마커 드로잉
function updateDeviceMarker(lat, lng) {
    if (deviceMarker) {
        deviceMarker.setLatLng([lat, lng]);
    } else {
        const pulseIcon = L.divIcon({
            className: 'device-pulse-marker',
            html: `<div style="width: 22px; height: 22px; background: #c084fc; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 15px #c084fc; animation: pulse 1s infinite;"></div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11]
        });
        deviceMarker = L.marker([lat, lng], { icon: pulseIcon }).addTo(map);
    }
    deviceMarker.bindPopup(`<strong>추적 대상 기기</strong><br><span style="font-size:11px; color:var(--accent-glow);">지리 패턴 실시간 스트리밍</span>`).openPopup();
}

// --- [수학 연산 1] 구면 위 두 점의 거리를 구하는 하버사인(Haversine) 정밀 공식 ---
function getHaversineDistanceMeter(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // 지구 반경 (미터 단위)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // 최종 최단 실거리(m) 도출
}

// --- [수학 연산 2] 점 P에서 라인(선분 세그먼트)들 사이의 최단거리 구하기 ---
function calculateMinDistanceToPath(pLat, pLng, pathCoords) {
    let minDistance = Infinity;

    for (let i = 0; i < pathCoords.length - 1; i++) {
        const nodeA = pathCoords[i];
        const nodeB = pathCoords[i + 1];

        // 선분 AB의 점들과 점 P 사이의 최단 프로젝션 투영 연산 수행
        const dist = getDistanceToSegmentMeter(pLat, pLng, nodeA[0], nodeA[1], nodeB[0], nodeB[1]);
        if (dist < minDistance) {
            minDistance = dist;
        }
    }
    return minDistance;
}

// 특정 선분 (x1, y1) -> (x2, y2)와 외부점 (px, py) 사이의 수선 발 최단거리 공식
function getDistanceToSegmentMeter(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;

    // 선분의 길이가 0인 예외 상황(같은 노드)일 경우 그냥 점과의 직선 거리 반환
    if (dx === 0 && dy === 0) {
        return getHaversineDistanceMeter(px, py, x1, y1);
    }

    // 선분 위의 투영 투사 가중치 t 산출
    let t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
    
    // t 범위가 0보다 작거나 1보다 크면 수선의 발이 선분 바깥 영역에 떨어짐을 의미
    // 이 경우 끝단 노드와의 거리를 구해 리턴합니다.
    if (t < 0) {
        return getHaversineDistanceMeter(px, py, x1, y1);
    } else if (t > 1) {
        return getHaversineDistanceMeter(px, py, x2, y2);
    }

    // 수선의 발이 선분 한복판에 착지하는 완벽한 정사영 투영 좌표 계산
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;

    return getHaversineDistanceMeter(px, py, projX, projY);
}

// --- [수학 연산 3] 다각형(Polygon) 내부의 점(Point) 판정 레이캐스팅(Ray-Casting) 알고리즘 ---
function checkPointInPolygon(lat, lng, polygon) {
    let inside = false;
    const count = polygon.length;

    // 다각형의 모서리들을 순회하며 수평 반직선(Ray)이 교차하는 홀수/짝수 판정
    for (let i = 0, j = count - 1; i < count; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];

        const intersect = ((yi > lat) !== (yj > lat)) &&
            (lng < (xj - xi) * (lat - yi) / (yj - yi + 0.000001) + xi); // 분모 제로 나눗셈 방지 처리
        
        if (intersect) {
            inside = !inside;
        }
    }
    return inside;
}

// --- [6. UI 테마 실시간 업데이트 및 긴급 SOS 전송 메시지 오토 빌딩] ---
function updatePanelUI(state, distance, zoneDesc, currentLat = 35.1376, currentLng = 126.7909) {
    const panel = document.getElementById("status-panel");
    const icon = document.getElementById("status-icon");
    const title = document.getElementById("status-title");
    const desc = document.getElementById("status-desc");
    const distMeterEl = document.getElementById("meter-distance");

    // 초기화 리셋 처리
    panel.className = "alarm-monitor";
    icon.className = "alarm-status-icon";

    if (state === "safe") {
        panel.classList.add("state-safe");
        icon.classList.add("ri-checkbox-circle-fill");
        icon.style.color = "var(--success)";
        title.innerText = "안전 이동 상태";
        title.style.color = "var(--success)";
        desc.innerText = "대상자가 지정된 골목 안전 권장 인도를 벗어나지 않고 안전하게 이동 중입니다.";
        distMeterEl.style.color = "var(--success)";
    } 
    else if (state === "warn") {
        panel.classList.add("state-warn");
        icon.classList.add("ri-error-warning-fill");
        icon.style.color = "var(--warning)";
        title.innerText = "⚠️ 안전 이동 이탈 경보";
        title.style.color = "var(--warning)";
        desc.innerText = `[이탈 상태 발생] 안전 권장 로선과 현재 위치의 누적 편차 거리가 ${distance.toFixed(1)}미터를 초과했습니다. 유선 유도가 권장됩니다.`;
        distMeterEl.style.color = "var(--warning)";
    } 
    else if (state === "danger") {
        panel.classList.add("state-danger");
        icon.classList.add("ri-alarm-warning-fill");
        icon.style.color = "var(--danger)";
        title.innerText = "🚨 1급 위험지역 진입 비상";
        title.style.color = "var(--danger-glow)";
        desc.innerText = `[출입 통제구역 침범!] 절벽 붕괴 및 추락사고 고위험 미인가 산림지대에 대상자가 무단 진입했습니다. 즉각적인 SOS 구조 신호가 발송됩니다.`;
        distMeterEl.style.color = "var(--danger)";
    }

    // 실시간 SOS 통신 전송용 JSON 오토 빌더 (Coolsms 발급 가이드용)
    const smsPayload = {
        "message": {
            "to": "010-XXXX-XXXX(보호자)",
            "from": "010-YYYY-YYYY(통제소)",
            "text": `[🚨긴급 조난 경보 - AI 통제반]\n보호 대상자 경로이탈 비상 검출!\n\n상태: ${zoneDesc}\n이탈 오차: ${distance.toFixed(1)}m\n현재좌표: ${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}\n\n즉시 실시간 위성 수색 지도에 진입하여 구조 바랍니다:\nhttps://map.kakao.com/link/map/조난자위치,${currentLat.toFixed(6)},${currentLng.toFixed(6)}`
        }
    };

    document.getElementById("text-sms-payload").value = JSON.stringify(smsPayload, null, 2);
}

function resetSmsPayloadText() {
    const defaultPayload = {
        "message": {
            "to": "010-XXXX-XXXX(보호자)",
            "from": "010-YYYY-YYYY(통제소)",
            "text": "실시간 대기 중... 정상 경로 이탈 또는 위험 구역 진입 시 SOS 전송 전문이 자동 조립됩니다."
        }
    };
    document.getElementById("text-sms-payload").value = JSON.stringify(defaultPayload, null, 2);
}
