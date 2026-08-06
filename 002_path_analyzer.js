/**
 * ==========================================================================
 * AI 전지역 확장형 GPS 이탈 및 커스텀 펜싱 통합 관제센터 엔진 (002_path_analyzer.js)
 * ==========================================================================
 * - 핵심 업그레이드 내역:
 *   1. [실시간 부드러운 도보 주행 엔진] 지도 클릭 시 순간이동이 아닌, 현재 위경도에서 클릭 지점까지 0.1초 단위의 세부 보간 연산으로 기기가 직접 걸어가는 애니메이션 연동
 *   2. [수제 대상자 동선 그리기] '대상자 가상 이동선 그리기' 도구를 장착하여, 사용자가 전 세계 어느 지형이든 직접 찍은 궤적선을 타고 추종 주행하게 설계
 * ==========================================================================
 */

// --- [1. 다중 지역 프리셋 지리 기하 공간 데이터베이스] ---
const areaPresetsDB = {
    // 1번 구역: 송정공원역 구역 (기존 주거공원 밀착지구)
    songjeong_park: {
        center: [35.1395, 126.7935],
        zoom: 16,
        safePathNodes: [
            [35.1376, 126.7909], // 송정역 입구
            [35.1388, 126.7915], 
            [35.1396, 126.7925], 
            [35.1408, 126.7938], 
            [35.1415, 126.7950]  // 송정 도서관 뒤편 주차장
        ],
        dangerPolygonCoords: [
            [35.1420, 126.7955],
            [35.1410, 126.7965],
            [35.1395, 126.7950],
            [35.1408, 126.7942]
        ],
        dangerCircleCenter: [35.1385, 126.7935],
        dangerCircleRadiusMeter: 35,
        // 해당 구역 전용 테스트 주행 시뮬레이터 동선 시퀀스
        trajectory: [
            { lat: 35.1376, lng: 126.7909 },
            { lat: 35.1382, lng: 126.7912 },
            { lat: 35.1388, lng: 126.7915 },
            { lat: 35.1392, lng: 126.7920 },
            { lat: 35.1396, lng: 126.7925 },
            { lat: 35.1392, lng: 126.7931 },
            { lat: 35.1386, lng: 126.7934 }, // 공사장 원 반경 침범
            { lat: 35.1401, lng: 126.7945 },
            { lat: 35.1409, lng: 126.7947 }, // 등로 이탈 헤매기
            { lat: 35.1411, lng: 126.7953 }, // 위험 다각형 늪지대 진입
            { lat: 35.1415, lng: 126.7958 },
            { lat: 35.1413, lng: 126.7954 }
        ]
    },
    // 2번 구역: 상무역 시청로 구역 (공공기관 및 행정 오피스 초밀집 번화가)
    sangmu_hall: {
        center: [35.1555, 126.8435],
        zoom: 16,
        safePathNodes: [
            [35.1512, 126.8404], // 상무역 4번출구 시작
            [35.1535, 126.8415], // 시청로 주요 사거리 대로변 인도
            [35.1558, 126.8427], // 롯데마트 광장 앞
            [35.1585, 126.8439], // 광주 시청 잔디 광장 입구 도착
        ],
        dangerPolygonCoords: [
            [35.1575, 126.8455], // 우범 골목 상가 철거 지구
            [35.1565, 126.8465],
            [35.1548, 126.8448],
            [35.1562, 126.8438]
        ],
        dangerCircleCenter: [35.1530, 126.8430], // 도로 중앙 철로 침하 씽크홀 발생 지역
        dangerCircleRadiusMeter: 40,
        trajectory: [
            { lat: 35.1512, lng: 126.8404 }, // 1. 상무역 정착
            { lat: 35.1524, lng: 126.8410 }, // 2. 정상 주행
            { lat: 35.1535, lng: 126.8415 }, // 3. 정상 대로변 주행
            { lat: 35.1532, lng: 126.8426 }, // 4. 차도 방향 이탈 시도
            { lat: 35.1531, lng: 126.8431 }, // 5. 도로 침하 싱크홀 위험 원 구역 40m 침범!
            { lat: 35.1545, lng: 126.8422 }, // 6. 다시 회복 시도
            { lat: 35.1558, lng: 126.8427 }, // 7. 롯데마트 앞 교차로 통과
            { lat: 35.1554, lng: 126.8444 }, // 8. 슬그머니 철거 상가 험난한 골목으로 방향 이탈
            { lat: 35.1560, lng: 126.8450 }, // 9. 골목 입구 통과 (정상로와 오차 폭증)
            { lat: 35.1566, lng: 126.8453 }, // 10. [비상사태] 낙하물 사고 다발 상가 철거 다각형 심장부 침입!
            { lat: 35.1570, lng: 126.8458 }, // 11. 내부 방황 조난
            { lat: 35.1568, lng: 126.8455 }  // 12. 최종 정지
        ]
    },
    // 3번 구역: 광주송정역 허브 구역 (KTX 복합환승지대 및 대형 교통 혼잡지역)
    gwangju_songjeong: {
        center: [35.1365, 126.7905],
        zoom: 16,
        safePathNodes: [
            [35.1376, 126.7909], // 광주송정역 1호선 환승 주차장
            [35.1360, 126.7892], // 송정역 사거리 통과 인도
            [35.1345, 126.7878], // 도산동 대도로변 서편 인도
            [35.1325, 126.7865]  // 도산초등학교 스쿨존 세이프 인도존
        ],
        dangerPolygonCoords: [
            [35.1355, 126.7925], // 버스 전용 차고지 및 대형 특수 화물 주차장 고위험지대
            [35.1345, 126.7935],
            [35.1332, 126.7915],
            [35.1343, 126.7905]
        ],
        dangerCircleCenter: [35.1352, 126.7874], // 도보 정비 구간 보도블록 유실 싱크홀 의심구역
        dangerCircleRadiusMeter: 30,
        trajectory: [
            { lat: 35.1376, lng: 126.7909 }, // KTX 광장 출발
            { lat: 35.1368, lng: 126.7900 },
            { lat: 35.1360, lng: 126.7892 }, // 교차로 무사 통과
            { lat: 35.1354, lng: 126.7885 },
            { lat: 35.1353, lng: 126.7877 }, // 보도블록 유실 원 구역 근접
            { lat: 35.1345, lng: 126.7878 }, // 정상 회복
            { lat: 35.1340, lng: 126.7895 }, // 우측 대형 차고지 방면으로 비정상 이탈
            { lat: 35.1342, lng: 126.7912 }, // [경보 격상] 이탈 증가
            { lat: 35.1338, lng: 126.7918 }, // [비상!] 버스 정비 철야 차고지 다각형 구역 무단 진입!
            { lat: 35.1344, lng: 126.7922 }, // 방황 조난 심화
            { lat: 35.1348, lng: 126.7928 }  // 최종 조난 정차
        ]
    }
};

// --- [2. 전역 상태 제어 변수] ---
let activePresetKey = "songjeong_park"; // 기본 선택 지역
let mapPresetLayers = [];              // 지도 상에 그려진 구역 폴백 레이어 저장 배열 (스위칭 시 지우기용)

// 커스텀 그리기 제어 상태
let drawMode = null;                   // 'safe_path', 'danger_polygon', 'user_trajectory' or null
let customSafePathCoords = [];         // 사용자가 동적으로 그린 커스텀 인도 노드들
let customDangerPolygonCoords = [];    // 사용자가 동적으로 그린 커스텀 위험 다각형 노드들
let customUserTrajectoryCoords = [];   // 사용자가 동적으로 그린 대상자 가상 주행 노드들 (신규 탑재!)

let customSafePathPolyline = null;     // 커스텀 인도 맵 객체
let customDangerPolygonLayer = null;    // 커스텀 위험 다각형 맵 객체
let customUserTrajectoryPolyline = null; // 커스텀 대상자 궤적선 맵 객체

// 트랙 관련 제어 변수
let mapObj;                     // Leaflet 지도
let deviceMarker;               // 대상 핀
let pathLine;                   // 동선 라인
let simulationInterval = null;  
let isSimulating = false;       
let currentStepIdx = 0;         
let elapsedSeconds = 0;         

// 실시간 부드러운 도보 애니메이션용 프레임 타이머 변수
let smoothWalkInterval = null;
let currentVirtualLat = 35.1376; // 가상 기기의 최종 위도 상태값
let currentVirtualLng = 126.7909; // 가상 기기의 최종 경도 상태값

// --- [3. 엔진 로딩 및 드롭다운 연동] ---
document.addEventListener("DOMContentLoaded", () => {
    initLeafletControlMap();       // 맵 인프라 구동
    registerPresetZoneChange();    // 지역 전환 이벤트 연동
    registerCustomDrawingTools();  // 실시간 펜스 그리기 툴바 활성화
    registerControlEvents();       // 시뮬레이터 시작/리셋 연동
    resetSmsPayloadText();         // 긴급 전문 세팅
});

function initLeafletControlMap() {
    // 최초 세팅: 송정공원역 구역 로드
    const initialPreset = areaPresetsDB[activePresetKey];
    currentVirtualLat = initialPreset.center[0];
    currentVirtualLng = initialPreset.center[1];

    mapObj = L.map("map", {
        zoomControl: false
    }).setView(initialPreset.center, initialPreset.zoom);

    L.control.zoom({ position: 'bottomright' }).addTo(mapObj);

    // 고품격 차콜 블랙 다크 무드 타일 탑재
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CartoDB',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(mapObj);

    // 구역 레이어 렌더링
    renderPresetLayers(activePresetKey);

    // 지도 마우스 클릭 핸들링 (통합 제어부: 그리기 모드일 때는 그리기 처리, 아닐 때는 수동 탐지 처리)
    mapObj.on("click", (e) => {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;

        if (drawMode === "safe_path") {
            addCustomSafePathNode(lat, lng);
        } else if (drawMode === "danger_polygon") {
            addCustomDangerPolygonNode(lat, lng);
        } else if (drawMode === "user_trajectory") {
            addCustomUserTrajectoryNode(lat, lng);
        } else {
            // 그리기 모드가 아닐 때 지도 임의 지점을 찍으면! 
            // 워프하지 않고, 현재 기기 위치에서 그 클릭 장소까지 실시간 부드러운 도보 주행 개시! (Premium 기능)
            if (isSimulating) {
                alert("가상 시나리오 시뮬레이션이 활발히 구동 중일 때는 수동 분석 클릭이 제한됩니다. 시뮬레이션을 일시정지하거나 초기화해 주세요!");
                return;
            }
            triggerSmoothWalkingToTarget(lat, lng);
        }
    });
}

// --- [4. 다중 지역 프리셋 맵 리로딩 코어 설계] ---
function registerPresetZoneChange() {
    const selector = document.getElementById("sel-control-zone-presets");

    selector.addEventListener("change", (e) => {
        const selectedKey = e.target.value;
        
        // 시뮬레이션이 돌고 있다면 우선 강제 초기화 리셋
        resetSimulationState();

        activePresetKey = selectedKey;

        // 1. 기존 프리셋 지도 그림들 지우기
        clearPresetLayers();

        // 2. 커스텀 모드가 아닌 일반 프리셋들의 경우 매핑 렌더링
        if (selectedKey !== "custom_world") {
            const preset = areaPresetsDB[selectedKey];
            
            // 지도 스무스 공간 비행 이동 (FlyTo)
            mapObj.flyTo(preset.center, preset.zoom, {
                animate: true,
                duration: 1.2
            });

            // 레이어 새로 고침
            renderPresetLayers(selectedKey);

            // 가상 좌표 갱신 후 분석 가동
            currentVirtualLat = preset.center[0];
            currentVirtualLng = preset.center[1];
            processGeoAiAnalysis(currentVirtualLat, currentVirtualLng);
        } else {
            alert("🌐 [실시간 커스텀 설계 모드 활성화]\n\n이제 원하시는 넓은 지역으로 지도를 자유롭게 이동하신 뒤,\n왼쪽 설계실의 그리기 버튼을 누르고 지도를 클릭해 나만의 안심/위험 구역을 자유롭게 창조해 보세요!\n\n또한, 지도 위 빈곳을 콕 누르면 추적 장치가 그곳을 향해 부드럽게 실시간 도보로 전진 수색합니다!");
        }
    });
}

// 프리셋 구역 지도 상에 실시간 도면 드로잉
function renderPresetLayers(key) {
    const preset = areaPresetsDB[key];
    if (!preset) return;

    // 1. 권장 도보로 (네온 그린 점선)
    const polylineLayer = L.polyline(preset.safePathNodes, {
        color: '#10b981',
        weight: 6,
        opacity: 0.8,
        dashArray: '10, 15',
        lineCap: 'round'
    }).addTo(mapObj);
    mapPresetLayers.push(polylineLayer);

    // 2. 위험 다각형 펜스 (붉은 다각형)
    const polygonLayer = L.polygon(preset.dangerPolygonCoords, {
        color: '#ef4444',
        weight: 2,
        fillColor: '#ef4444',
        fillOpacity: 0.2,
        dashArray: '5, 5'
    }).addTo(mapObj);
    mapPresetLayers.push(polygonLayer);

    // 3. 위험 원형 펜스 (주황-레드 원)
    const circleLayer = L.circle(preset.dangerCircleCenter, {
        radius: preset.dangerCircleRadiusMeter,
        color: '#ef4444',
        weight: 2,
        fillColor: '#f59e0b',
        fillOpacity: 0.15
    }).addTo(mapObj);
    mapPresetLayers.push(circleLayer);
}

// 화면 교체 시 이전에 그려둔 임시 프리셋 붓 레이어 자국 영구 지우기
function clearPresetLayers() {
    mapPresetLayers.forEach(layer => {
        if (mapObj.hasLayer(layer)) {
            mapObj.removeLayer(layer);
        }
    });
    mapPresetLayers = [];
}

// --- [5. 실시간 커스텀 펜싱 및 대상자 궤적 드로잉 빌더 엔진 제어] ---
function registerCustomDrawingTools() {
    const btnDrawSafe = document.getElementById("btn-draw-safe-path");
    const btnDrawDanger = document.getElementById("btn-draw-danger-fence");
    const btnDrawTrajectory = document.getElementById("btn-draw-user-trajectory");
    const btnClearCustom = document.getElementById("btn-clear-custom-drawing");

    btnDrawSafe.addEventListener("click", () => {
        if (drawMode === "safe_path") {
            deactivateDrawingMode();
        } else {
            deactivateDrawingMode();
            drawMode = "safe_path";
            btnDrawSafe.classList.add("drawing-active");
            btnDrawSafe.innerHTML = `<i class="ri-checkbox-circle-line"></i> 설계 완료 (종료)`;
            mapObj.getContainer().style.cursor = "crosshair"; // 마우스 커서를 정밀 십자선 무드로 전환
        }
    });

    btnDrawDanger.addEventListener("click", () => {
        if (drawMode === "danger_polygon") {
            deactivateDrawingMode();
        } else {
            deactivateDrawingMode();
            drawMode = "danger_polygon";
            btnDrawDanger.classList.add("drawing-active");
            btnDrawDanger.innerHTML = `<i class="ri-checkbox-circle-line"></i> 설계 완료 (종료)`;
            mapObj.getContainer().style.cursor = "crosshair";
        }
    });

    btnDrawTrajectory.addEventListener("click", () => {
        if (drawMode === "user_trajectory") {
            deactivateDrawingMode();
        } else {
            deactivateDrawingMode();
            drawMode = "user_trajectory";
            btnDrawTrajectory.classList.add("drawing-active");
            btnDrawTrajectory.style.background = "#ef4444";
            btnDrawTrajectory.style.borderColor = "#f87171";
            btnDrawTrajectory.innerHTML = `<i class="ri-checkbox-circle-line"></i> 설계 완료 (종료)`;
            mapObj.getContainer().style.cursor = "crosshair";
        }
    });

    btnClearCustom.addEventListener("click", () => {
        clearCustomDrawingLayers();
    });
}

function deactivateDrawingMode() {
    drawMode = null;
    mapObj.getContainer().style.cursor = "";

    const btnDrawSafe = document.getElementById("btn-draw-safe-path");
    const btnDrawDanger = document.getElementById("btn-draw-danger-fence");
    const btnDrawTrajectory = document.getElementById("btn-draw-user-trajectory");

    btnDrawSafe.classList.remove("drawing-active");
    btnDrawSafe.innerHTML = `<i class="ri-vector-line"></i> 정상 인도 그리기`;

    btnDrawDanger.classList.remove("drawing-active");
    btnDrawDanger.innerHTML = `<i class="ri-polygon-line"></i> 위험 구역 그리기`;

    btnDrawTrajectory.classList.remove("drawing-active");
    btnDrawTrajectory.style.background = "rgba(192, 132, 252, 0.1)";
    btnDrawTrajectory.style.borderColor = "#c084fc";
    btnDrawTrajectory.innerHTML = `<i class="ri-route-line"></i> 🏃 대상자 가상 이동선(궤적) 직접 그리기`;
}

// 사용자가 지도를 누를 때마다 동적 정상로 노드 추가 연산
function addCustomSafePathNode(lat, lng) {
    customSafePathCoords.push([lat, lng]);

    if (customSafePathPolyline) {
        customSafePathPolyline.setLatLngs(customSafePathCoords);
    } else {
        customSafePathPolyline = L.polyline(customSafePathCoords, {
            color: '#10b981',
            weight: 6,
            opacity: 0.9,
            dashArray: '10, 15',
            lineCap: 'round'
        }).addTo(mapObj);
    }
}

// 사용자가 지도를 누를 때마다 동적 위험 다각형 노드 추가 연산
function addCustomDangerPolygonNode(lat, lng) {
    customDangerPolygonCoords.push([lat, lng]);

    if (customDangerPolygonLayer) {
        customDangerPolygonLayer.setLatLngs(customDangerPolygonCoords);
    } else {
        customDangerPolygonLayer = L.polygon(customDangerPolygonCoords, {
            color: '#ef4444',
            weight: 2,
            fillColor: '#ef4444',
            fillOpacity: 0.25,
            dashArray: '5, 5'
        }).addTo(mapObj);
    }
}

// 사용자가 지도를 누를 때마다 수제 가상 주행 궤적 노드 추가 연산 (신규 탑재!)
function addCustomUserTrajectoryNode(lat, lng) {
    customUserTrajectoryCoords.push([lat, lng]);

    if (customUserTrajectoryPolyline) {
        customUserTrajectoryPolyline.setLatLngs(customUserTrajectoryCoords);
    } else {
        customUserTrajectoryPolyline = L.polyline(customUserTrajectoryCoords, {
            color: '#a78bfa',
            weight: 4,
            opacity: 0.85,
            dashArray: '4, 8'
        }).addTo(mapObj);
    }

    // 첫 수제 클릭 좌표에 가상 추적 장치의 좌표 핀을 살며시 얹어 동기화합니다
    if (customUserTrajectoryCoords.length === 1) {
        currentVirtualLat = lat;
        currentVirtualLng = lng;
        updateDeviceMarker(lat, lng);
        processGeoAiAnalysis(lat, lng);
    }
}

// 수제 그리기 객체들 맵에서 완전히 박살내고 소멸시키기
function clearCustomDrawingLayers() {
    deactivateDrawingMode();

    if (customSafePathPolyline) {
        mapObj.removeLayer(customSafePathPolyline);
        customSafePathPolyline = null;
    }
    if (customDangerPolygonLayer) {
        mapObj.removeLayer(customDangerPolygonLayer);
        customDangerPolygonLayer = null;
    }
    if (customUserTrajectoryPolyline) {
        mapObj.removeLayer(customUserTrajectoryPolyline);
        customUserTrajectoryPolyline = null;
    }

    customSafePathCoords = [];
    customDangerPolygonCoords = [];
    customUserTrajectoryCoords = [];
    alert("🧹 그려두셨던 커스텀 정상로, 가상 위험구역 및 수제 가상 이동선이 깨끗하게 일괄 정화되었습니다.");
}

// --- [6. PREMIUM: 클릭 지점까지 실시간 부드러운 도보 보행 애니메이션 구현] ---
function triggerSmoothWalkingToTarget(targetLat, targetLng) {
    // 기존에 도보 애니메이션 타이머가 돌고 있었다면 안전하게 클리어
    if (smoothWalkInterval) {
        clearInterval(smoothWalkInterval);
        smoothWalkInterval = null;
    }

    // 가상 기기의 현재 출발점 좌표 셋업
    let fromLat = currentVirtualLat;
    let fromLng = currentVirtualLng;

    // 목적지와의 구면 직선 거리(m) 산출
    const totalDistance = getHaversineDistanceMeter(fromLat, fromLng, targetLat, targetLng);
    
    // 평균 도보 속도 (초당 약 1.4m 전진)를 기준으로, 프레임 세분화 분할 상수 결정
    // 프레임당 약 0.1초 단위 보간을 주어 부드럽게 기어가게 만듭니다
    const stepSpeedPerDeciSec = 2.0; // 프레임(100ms) 당 약 2미터 이동하는 가벼운 발걸음 속도
    const totalStepsRequired = Math.max(10, Math.ceil(totalDistance / stepSpeedPerDeciSec)); 
    let currentStep = 0;

    // 지도 상에 사용자가 수동 수색 목적으로 클릭한 임시 목적지 깃발 레이어 피드백 생성
    const tempTargetMarker = L.circleMarker([targetLat, targetLng], {
        radius: 8,
        color: '#10b981',
        fillColor: '#10b981',
        fillOpacity: 0.6
    }).addTo(mapObj).bindPopup("<span style='font-size:11px;font-weight:600;'>가상 추적 수색 목적지</span>").openPopup();

    smoothWalkInterval = setInterval(() => {
        if (currentStep <= totalStepsRequired) {
            // 삼각비율 선형 공간 보간 공식 적용 (Linear Interpolation)
            const ratio = currentStep / totalStepsRequired;
            currentVirtualLat = fromLat + (targetLat - fromLat) * ratio;
            currentVirtualLng = fromLng + (targetLng - fromLng) * ratio;

            // 이동 시점의 기하 위험성 수렴 판정 호출! (걷는 동안 주의/비상 실시간 동적 전격 반응)
            processGeoAiAnalysis(currentVirtualLat, currentVirtualLng);

            // 이동 경로 트레일 궤적선 그리기
            if (pathLine) {
                pathLine.addLatLng([currentVirtualLat, currentVirtualLng]);
            } else {
                pathLine = L.polyline([[currentVirtualLat, currentVirtualLng]], {
                    color: '#c084fc',
                    weight: 4,
                    opacity: 0.9
                }).addTo(mapObj);
            }

            currentStep++;
        } else {
            // 목적지 최종 도착
            clearInterval(smoothWalkInterval);
            smoothWalkInterval = null;
            currentVirtualLat = targetLat;
            currentVirtualLng = targetLng;
            processGeoAiAnalysis(targetLat, targetLng);

            // 임시 목적지 마커 부드러운 소멸 제거
            if (mapObj.hasLayer(tempTargetMarker)) {
                mapObj.removeLayer(tempTargetMarker);
            }
        }
    }, 100); // 100ms 프레임마다 물리 공간 좌표 가속
}

// --- [7. 수동 수색 통제반 시뮬레이터 제어] ---
function registerControlEvents() {
    const btnToggle = document.getElementById("btn-toggle-simulation");
    const btnReset = document.getElementById("btn-reset-simulation");

    btnToggle.addEventListener("click", () => {
        if (isSimulating) {
            stopSimulation();
        } else {
            startSimulation();
        }
    });

    btnReset.addEventListener("click", () => {
        resetSimulationState();
    });
}

function startSimulation() {
    // 만약 사용자가 "수제 대상자 동선 그리기"를 그려둔 상태라면 그 데이터를 우선 궤적으로 삼습니다!
    let driveSequence = [];
    
    if (customUserTrajectoryCoords.length >= 2) {
        driveSequence = customUserTrajectoryCoords.map(coord => ({ lat: coord[0], lng: coord[1] }));
    } else if (activePresetKey !== "custom_world") {
        driveSequence = areaPresetsDB[activePresetKey].trajectory;
    } else if (customSafePathCoords.length >= 2) {
        // 커스텀 모드인데 정상 경로만 그려놓은 경우 (약간의 이탈 오프셋을 입혀 자동 주행 연산)
        driveSequence = customSafePathCoords.map((coord, index) => {
            if (index >= Math.floor(customSafePathCoords.length / 2)) {
                return { lat: coord[0] + (index * 0.00015), lng: coord[1] + (index * 0.0001) };
            }
            return { lat: coord[0], lng: coord[1] };
        });
    }

    if (driveSequence.length < 2) {
        alert("⚠️ [가상 이동선 수색 노선 부족]\n\n가상 주행 시뮬레이션을 가동하려면 현재 선택한 지역 프리셋이거나, 혹은 지도 상에 직접 [대상자 가상 이동선]을 2군데 이상 툭툭 찍어 주행로를 설계해 주셔야 합니다!");
        return;
    }

    isSimulating = true;
    const btnToggle = document.getElementById("btn-toggle-simulation");
    btnToggle.innerHTML = `<i class="ri-pause-fill"></i> 가상 수색 일시정지`;
    btnToggle.style.background = "linear-gradient(135deg, var(--warning) 0%, #d97706 100%)";
    btnToggle.style.boxShadow = "0 4px 12px rgba(245, 158, 11, 0.3)";

    if (currentStepIdx >= driveSequence.length) {
        currentStepIdx = 0;
        elapsedSeconds = 0;
        if (pathLine) {
            pathLine.setLatLngs([]);
        }
    }

    simulationInterval = setInterval(() => {
        if (currentStepIdx < driveSequence.length) {
            const currentPoint = driveSequence[currentStepIdx];
            currentVirtualLat = currentPoint.lat;
            currentVirtualLng = currentPoint.lng;

            processGeoAiAnalysis(currentVirtualLat, currentVirtualLng);
            
            if (pathLine) {
                pathLine.addLatLng([currentVirtualLat, currentVirtualLng]);
            } else {
                pathLine = L.polyline([[currentVirtualLat, currentVirtualLng]], {
                    color: '#c084fc',
                    weight: 4,
                    opacity: 0.9
                }).addTo(mapObj);
            }

            currentStepIdx++;
            elapsedSeconds += 3;
            updateTimeDisplay();
        } else {
            stopSimulation();
            alert("🏁 관제 시나리오 추적이 무사히 완료되었습니다.");
        }
    }, 1500);
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
    if (smoothWalkInterval) {
        clearInterval(smoothWalkInterval);
        smoothWalkInterval = null;
    }

    currentStepIdx = 0;
    elapsedSeconds = 0;
    updateTimeDisplay();

    if (pathLine) {
        mapObj.removeLayer(pathLine);
        pathLine = null;
    }
    if (deviceMarker) {
        mapObj.removeLayer(deviceMarker);
        deviceMarker = null;
    }

    // 가상 장치 위치 원래대로 중앙 복귀
    if (activePresetKey !== "custom_world") {
        const preset = areaPresetsDB[activePresetKey];
        currentVirtualLat = preset.center[0];
        currentVirtualLng = preset.center[1];
    } else {
        currentVirtualLat = 35.1376;
        currentVirtualLng = 126.7909;
    }

    updateDeviceMarker(currentVirtualLat, currentVirtualLng);
    processGeoAiAnalysis(currentVirtualLat, currentVirtualLng);
    resetSmsPayloadText();
}

function updateTimeDisplay() {
    const min = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
    const sec = String(elapsedSeconds % 60).padStart(2, "0");
    document.getElementById("meter-time").innerText = `${min}분 ${sec}초`;
}

// --- [8. 기하 공간 감지 알고리즘 연계 융합 분석 모듈] ---
function processGeoAiAnalysis(lat, lng) {
    document.getElementById("meter-coords").innerText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    updateDeviceMarker(lat, lng);

    // 타겟 지리 기하 기준 축 정의 (프리셋이거나 혹은 사용자가 수제로 그린 커스텀 공간이 대상)
    let safePathTarget = [];
    let dangerPolygonTarget = [];
    let circleCenterTarget = null;
    let circleRadiusTarget = 0;

    if (activePresetKey !== "custom_world") {
        const preset = areaPresetsDB[activePresetKey];
        safePathTarget = preset.safePathNodes;
        dangerPolygonTarget = preset.dangerPolygonCoords;
        circleCenterTarget = preset.dangerCircleCenter;
        circleRadiusTarget = preset.dangerCircleRadiusMeter;
    } else {
        safePathTarget = customSafePathCoords;
        dangerPolygonTarget = customDangerPolygonCoords;
        circleCenterTarget = [0, 0];
        circleRadiusTarget = 0;
    }

    // --- [알고리즘 1] 정상 경로와의 최단 이탈 실거리(m) 구하기 ---
    let deviationDistance = 0;
    if (safePathTarget.length >= 2) {
        deviationDistance = calculateMinDistanceToPath(lat, lng, safePathTarget);
    }
    document.getElementById("meter-distance").innerText = `${deviationDistance.toFixed(2)} m`;

    // --- [알고리즘 2] 위험 원 바운더리 침범 여부 판단 ---
    let insideDangerCircle = false;
    if (circleRadiusTarget > 0) {
        const distToCircleCenter = getHaversineDistanceMeter(lat, lng, circleCenterTarget[0], circleCenterTarget[1]);
        insideDangerCircle = distToCircleCenter <= circleRadiusTarget;
    }

    // --- [알고리즘 3] 위험 다각형 Geofencing 펜스 돌파 여부 판단 (Ray-Casting PIP) ---
    let insideDangerPolygon = false;
    if (dangerPolygonTarget.length >= 3) {
        insideDangerPolygon = checkPointInPolygon(lat, lng, dangerPolygonTarget);
    }

    // 종합 위기 상태 결정
    let finalState = "safe";
    let zoneText = "안전 구역 체류";

    if (insideDangerPolygon) {
        finalState = "danger";
        zoneText = "🚨 통제 위험 다각형 구역 내부 침범!";
    } else if (insideDangerCircle) {
        finalState = "warn";
        zoneText = "⚠️ 정밀 위험 구역 근접!";
    } else if (deviationDistance > 30) {
        finalState = "warn";
        zoneText = "⚠️ 골목길 이탈 상태";
    }

    document.getElementById("meter-danger-zone").innerText = zoneText;
    updatePanelUI(finalState, deviationDistance, zoneText, lat, lng);
}

// 기기 현재 위치 마커 아이콘 실시간 렌더링
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
        deviceMarker = L.marker([lat, lng], { icon: pulseIcon }).addTo(mapObj);
    }
}

// --- [공간 수학 연산 유틸들] ---

// Haversine 지구 구면 직선 실거리(m) 공식
function getHaversineDistanceMeter(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// 점과 선분들(배열) 사이의 최단거리 구하기
function calculateMinDistanceToPath(pLat, pLng, pathCoords) {
    let minDistance = Infinity;

    for (let i = 0; i < pathCoords.length - 1; i++) {
        const nodeA = pathCoords[i];
        const nodeB = pathCoords[i + 1];

        const dist = getDistanceToSegmentMeter(pLat, pLng, nodeA[0], nodeA[1], nodeB[0], nodeB[1]);
        if (dist < minDistance) {
            minDistance = dist;
        }
    }
    return minDistance;
}

// 점 P에서 선분 AB 사이의 정사영 투영 거리 구하기
function getDistanceToSegmentMeter(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;

    if (dx === 0 && dy === 0) {
        return getHaversineDistanceMeter(px, py, x1, y1);
    }

    let t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
    
    if (t < 0) {
        return getHaversineDistanceMeter(px, py, x1, y1);
    } else if (t > 1) {
        return getHaversineDistanceMeter(px, py, x2, y2);
    }

    const projX = x1 + t * dx;
    const projY = y1 + t * dy;

    return getHaversineDistanceMeter(px, py, projX, projY);
}

// 임의 다각형 내부 침범 감지 Ray-Casting PIP 알고리즘
function checkPointInPolygon(lat, lng, polygon) {
    let inside = false;
    const count = polygon.length;

    for (let i = 0, j = count - 1; i < count; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];

        const intersect = ((yi > lat) !== (yj > lat)) &&
            (lng < (xj - xi) * (lat - yi) / (yj - yi + 0.000001) + xi);
        
        if (intersect) {
            inside = !inside;
        }
    }
    return inside;
}

// UI 테마 색감 변경 및 SMS 구조 통신 전문 조립 빌더
function updatePanelUI(state, distance, zoneDesc, currentLat = 35.1376, currentLng = 126.7909) {
    const panel = document.getElementById("status-panel");
    const icon = document.getElementById("status-icon");
    const title = document.getElementById("status-title");
    const desc = document.getElementById("status-desc");
    const distMeterEl = document.getElementById("meter-distance");

    panel.className = "alarm-monitor";
    icon.className = "alarm-status-icon";

    if (state === "safe") {
        panel.classList.add("state-safe");
        icon.classList.add("ri-checkbox-circle-fill");
        icon.style.color = "var(--success)";
        title.innerText = "안전 이동 상태";
        title.style.color = "var(--success)";
        desc.innerText = "대상자가 지정된 안전 권장 인도를 벗어나지 않고 쾌적하게 이동하고 있습니다.";
        distMeterEl.style.color = "var(--success)";
    } 
    else if (state === "warn") {
        panel.classList.add("state-warn");
        icon.classList.add("ri-error-warning-fill");
        icon.style.color = "var(--warning)";
        title.innerText = "⚠️ 안전 이동 이탈 경보";
        title.style.color = "var(--warning)";
        desc.innerText = `[이탈 상태 발생] 수립된 정상 안전 통로와 현재 대상자의 공간 편차 거리가 ${distance.toFixed(1)}미터를 넘어섰습니다.`;
        distMeterEl.style.color = "var(--warning)";
    } 
    else if (state === "danger") {
        panel.classList.add("state-danger");
        icon.classList.add("ri-alarm-warning-fill");
        icon.style.color = "var(--danger)";
        title.innerText = "🚨 1급 위험지역 진입 비상";
        title.style.color = "var(--danger-glow)";
        desc.innerText = `[출입 차단구역 돌파!] 사고다발 철거 현장 또는 고위험 미인가 산림지대에 대상자가 무단 체류 중입니다. 즉시 긴급 수색 대책을 강구해야 합니다.`;
        distMeterEl.style.color = "var(--danger)";
    }

    const smsPayload = {
        "message": {
            "to": "010-XXXX-XXXX(보호자)",
            "from": "010-YYYY-YYYY(관제소)",
            "text": `[🚨긴급 조난 구역 경보]\n실시간 대상자 위치 이탈 감지!\n\n현재 상태: ${zoneDesc}\n최단 이탈 편차: ${distance.toFixed(1)}m\n경위도 좌표: ${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}\n\n아래 보안 위성 지도로 긴급 침투 구조해 주세요:\nhttps://map.kakao.com/link/map/조난자실시간위치,${currentLat.toFixed(6)},${currentLng.toFixed(6)}`
        }
    };

    document.getElementById("text-sms-payload").value = JSON.stringify(smsPayload, null, 2);
}

function resetSmsPayloadText() {
    const defaultPayload = {
        "message": {
            "to": "010-XXXX-XXXX(보호자)",
            "from": "010-YYYY-YYYY(관제소)",
            "text": "실시간 대기 중... 정상 경로 이탈 또는 위험 구역 진입 시 SOS 전송 전문이 자동 조립됩니다."
        }
    };
    document.getElementById("text-sms-payload").value = JSON.stringify(defaultPayload, null, 2);
}
