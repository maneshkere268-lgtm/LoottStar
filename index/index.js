/* ═══════════════ INDEX (КОЛЛЕКЦИЯ) ═══════════════ */

// 1. Формируем каталог всех предметов из всех кейсов
function buildIndexCatalog() {
    const catalog = {};
    
    // Раздел "Treasure Hunt" (вынесенные предметы)
    catalog['Treasure Hunt'] = [
        { name: 'Durov Figure (Mamont)', price: 100000000, image: 'images/DurovFigureMamont.png' },
        { name: 'Durov Figure (Mummy)', price: 10000000, image: 'images/DurovFigureMummy.png' },
        { name: 'Durov Figure (T-Rex)', price: 5641999, image: 'images/DurovFigureT-Rex.png' },
    ];

    // Раздел "Все" (собираем уникальные предметы из всех кейсов)
    const allUnique = new Map();
    CASES.forEach(c => {
        c.items.forEach(it => {
            if (!allUnique.has(it.name)) {
                allUnique.set(it.name, {
                    name: it.name,
                    price: it.price,
                    image: getGiftImageByName(it.name, it.price, it.image)
                });
            }
        });
    });
    catalog['Все'] = Array.from(allUnique.values()).sort((a, b) => b.price - a.price);

    return catalog;
}

let currentIndexCategory = 'Все';
let indexCatalog = {};

function getCollectionHistory() {
    const names = new Set();
    const addName = item => {
        const name = typeof item === 'string' ? item : item?.name;
        if (typeof name === 'string' && name.trim()) {
            names.add(name.trim().toLocaleLowerCase());
        }
    };

    try {
        const history = JSON.parse(localStorage.getItem('userCollectionItems') || '[]');
        if (Array.isArray(history)) history.forEach(addName);
    } catch (e) {
        console.warn('[index] collection history cache is invalid:', e);
    }

    getInventory().forEach(addName);
    return names;
}

// 2. Открытие/Закрытие
function openIndex() {
    indexCatalog = buildIndexCatalog();
    currentIndexCategory = 'Все';
    $('indexModal').classList.add('open');
    renderIndexSidebar();
    renderIndexGrid();
}

function closeIndex() {
    $('indexModal').classList.remove('open');
}

// 3. Отрисовка бокового меню
function renderIndexSidebar() {
    const sidebar = $('indexSidebar');
    const collectionHistory = getCollectionHistory();
    
    let html = '';
    Object.keys(indexCatalog).forEach(catName => {
        const items = indexCatalog[catName];
        const ownedCount = items.filter(it =>
            collectionHistory.has(it.name.trim().toLocaleLowerCase())
        ).length;
        
        html += `
            <button class="sidebar-btn ${currentIndexCategory === catName ? 'active' : ''}" 
                    onclick="setIndexCategory('${catName}')">
                <span>${catName}</span>
                <span class="count">${ownedCount}/${items.length}</span>
            </button>
        `;
    });
    sidebar.innerHTML = html;
}

function setIndexCategory(cat) {
    currentIndexCategory = cat;
    renderIndexSidebar();
    renderIndexGrid();
}

// 4. Отрисовка сетки предметов
function renderIndexGrid() {
    const grid = $('indexGrid');
    const collectionHistory = getCollectionHistory();
    const inventory = getInventory();
    const missingOnly = $('missingOnlyToggle').checked;
    const searchQ = $('indexSearch').value.toLowerCase().trim();
    
    let items = indexCatalog[currentIndexCategory] || [];
    
    // Фильтр по поиску
    if (searchQ) {
        items = items.filter(it => it.name.toLowerCase().includes(searchQ));
    }
    
    // Фильтр "Только отсутствующие"
    if (missingOnly) {
        items = items.filter(it => !collectionHistory.has(it.name.trim().toLocaleLowerCase()));
    }

    // Считаем прогресс
    const totalInCat = indexCatalog[currentIndexCategory].length;
    const ownedInCat = indexCatalog[currentIndexCategory].filter(it =>
        collectionHistory.has(it.name.trim().toLocaleLowerCase())
    ).length;
    const percent = totalInCat > 0 ? Math.round((ownedInCat / totalInCat) * 100) : 0;
    $('indexProgress').textContent = `${currentIndexCategory} ${ownedInCat}/${totalInCat} (${percent}%)`;

    // Рендер карточек
    if (items.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #666; padding: 40px;">Ничего не найдено</div>';
        return;
    }

    grid.innerHTML = items.map(it => {
        const ownedItems = inventory.filter(inv =>
            typeof inv.name === 'string' &&
            inv.name.trim().toLocaleLowerCase() === it.name.trim().toLocaleLowerCase()
        );
        const isOwned = collectionHistory.has(it.name.trim().toLocaleLowerCase());
        const isTreasure = currentIndexCategory === 'Treasure Hunt';
        
        // Плашка "Only from case"
        let tagHtml = '';
        if (isTreasure) {
            tagHtml = '<div class="idx-tag" style="color:#e8548a;">only from the case</div>';
        }

        return `
            <div class="idx-card ${isOwned ? '' : 'missing'}">
                <div class="idx-name">${window.escapeHtml(it.name)}</div>
                <div class="idx-img-box">
                    <img src="${it.image}" alt="" onerror="this.onerror=null;this.src='${window.GIFT_FALLBACK}'">
                    ${!isOwned ? `
                        <div class="idx-lock">
                            <img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f512.svg" alt="lock">
                        </div>
                    ` : ''}
                </div>
                <div class="idx-price"><img src="${window.STAR_ICON || '/shared/star.png'}" alt="">${window.formatStars(it.price)}</div>
                ${isOwned ? `<div class="idx-count">${ownedItems.length ? `${ownedItems.length}/1` : '✓'}</div>` : ''}
                ${tagHtml}
            </div>
        `;
    }).join('');
}

// Экспорт функций в window
window.openIndex = openIndex;
window.closeIndex = closeIndex;
window.setIndexCategory = setIndexCategory;
window.renderIndexGrid = renderIndexGrid;