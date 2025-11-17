// ==UserScript==
// @name         Flibusta Comment Highlighter
// @namespace    http://tampermonkey.net/
// @version      8.1
// @description  Подсвечивает комментарии пользователей из чёрного/белого списков с переключением режимов
// @author       Your Name
// @match        *://flibusta.is/*
// @match        *://flibustaongezhld6dibs2dps6vm4nvqg2kp7vgowbu76tzopgnhazqd.onion/*
// @match        *://zmw2cyw2vj7f6obx3msmdvdepdhnw2ctc4okza2zjxlukkdfckhq.b32.i2p/*
// @match        *://flibusta.i2p/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // Конфигурация
    const config = {
        debug: true,
        highlightColors: {
            whitelist: '#11AA44',
            blacklist: '#FF4444'
        }
    };

    // Режимы подсветки
    const HIGHLIGHT_MODES = {
        MY_LISTS: 'my_lists',           // Мой белый/черный список
        THEIR_LISTS: 'their_lists',     // Я в белом/черном списке
        BOTH: 'both'                    // Оба режима
    };

    // Получение текущего режима
    function getHighlightMode() {
        return GM_getValue('highlight_mode', HIGHLIGHT_MODES.THEIR_LISTS);
    }

    // Установка режима
    function setHighlightMode(mode) {
        GM_setValue('highlight_mode', mode);
        log(`Режим подсветки изменен на: ${getModeDescription(mode)}`);
        location.reload();
    }

    // Описание режимов
    function getModeDescription(mode) {
        const descriptions = {
            [HIGHLIGHT_MODES.MY_LISTS]: 'Мои списки (белый/черный)',
            [HIGHLIGHT_MODES.THEIR_LISTS]: 'Я в списках у других',
            [HIGHLIGHT_MODES.BOTH]: 'Все режимы'
        };
        return descriptions[mode] || mode;
    }

    // Стили для подсветки
    GM_addStyle(`
        .fl-highlight-whitelist {
            border-left: 3px solid ${config.highlightColors.whitelist} !important;
            padding-left: 8px !important;
            background-color: ${config.highlightColors.whitelist}10 !important;
        }
        .fl-highlight-blacklist {
            border-left: 3px solid ${config.highlightColors.blacklist} !important;
            padding-left: 8px !important;
            background-color: ${config.highlightColors.blacklist}10 !important;
            opacity: 0.9 !important;
        }
        .fl-highlighted-username {
            font-weight: bold !important;
            padding: 1px 4px !important;
            border-radius: 3px !important;
        }
        .fl-whitelist-name {
            color: ${config.highlightColors.whitelist} !important;
            background-color: ${config.highlightColors.whitelist}15 !important;
        }
        .fl-blacklist-name {
            color: ${config.highlightColors.blacklist} !important;
            background-color: ${config.highlightColors.blacklist}15 !important;
        }
        #fl-highlighter-debug {
            position: fixed;
            bottom: 10px;
            right: 10px;
            width: 500px;
            height: 200px;
            background: rgba(0,0,0,0.8);
            color: #00ff00;
            font-family: monospace;
            font-size: 12px;
            padding: 10px;
            overflow: auto;
            z-index: 9999;
            border: 1px solid #00ff00;
            border-radius: 5px;
        }
    `);

    // Система логирования
    function log(...args) {
        if (config.debug) {
            console.log('[Flibusta Highlighter]', ...args);
        }
    }

    // Основная функция
    function init() {
        log('Скрипт запущен');
        log(`Текущий режим: ${getHighlightMode()}`);

        // Поиск комментариев
        const comments = document.querySelectorAll(`
            div.author-name > a[href^="/user/"],
            div.submitted > a[href^="/user/"],
            .comment-author a[href^="/user/"],
            .username a[href^="/user/"]
        `);

        if (comments.length === 0) return;

        // Получение ID пользователя
        getUserId().then(userId => {
            if (!userId) return;
            processBWLists(userId, comments);
        });
    }

    // Получение ID пользователя
    function getUserId() {
        return new Promise((resolve) => {
            // Ручной ввод
            const manualId = GM_getValue('manual_user_id');
            if (manualId) return resolve(manualId);

            // Автоматическое определение
            GM_xmlhttpRequest({
                method: 'GET',
                url: '/user/me',
                onload: function(response) {
                    if (response.status !== 200) return resolve(null);

                    try {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(response.responseText, 'text/html');
                        const bwListLink = doc.querySelector('a[href^="/bwlist"]');
                        if (bwListLink) {
                            resolve(bwListLink.href.split('/').pop());
                        }
                    } catch (error) {
                        resolve(null);
                    }
                }
            });
        });
    }

    // Обработка списков
    function processBWLists(userId, comments) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: `/bwlist/show/${userId}`,
            onload: function(response) {
                if (response.status !== 200) return;

                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(response.responseText, 'text/html');
                    const mode = getHighlightMode();

                    let myWhitelist = [];
                    let myBlacklist = [];
                    let whitelisters = [];
                    let blacklisters = [];

                    // Всегда извлекаем все данные
                    myWhitelist = extractIds(doc, 1); // Мой белый список
                    myBlacklist = extractIds(doc, 2); // Мой черный список
                    whitelisters = extractIds(doc, 3); // Я в белом списке у...
                    blacklisters = extractIds(doc, 4); // Я в черном списке у...

                    log(`Найдено: мои белые=${myWhitelist.length}, мои черные=${myBlacklist.length}, я в белых=${whitelisters.length}, я в черных=${blacklisters.length}`);

                    // Применяем подсветку в зависимости от режима
                    switch (mode) {
                        case HIGHLIGHT_MODES.MY_LISTS:
                            applyHighlighting(comments, myBlacklist, myWhitelist, 'my');
                            break;
                        case HIGHLIGHT_MODES.THEIR_LISTS:
                            applyHighlighting(comments, blacklisters, whitelisters, 'their');
                            break;
                        case HIGHLIGHT_MODES.BOTH:
                            applyHighlightingBoth(comments, {
                                myWhitelist, myBlacklist, whitelisters, blacklisters
                            });
                            break;
                    }
                } catch (error) {
                    log('Ошибка обработки списков:', error);
                }
            }
        });
    }

    // Извлечение ID
    function extractIds(doc, columnIndex) {
        const ids = [];
        const nodes = doc.querySelectorAll(
            `#main > table > tbody > tr + tr > td:nth-child(${columnIndex}) > a + a + a`
        );

        nodes.forEach(a => {
            const id = a.href.split('/').pop();
            if (id) ids.push(id);
        });

        return ids;
    }

    // Применение подсветки для одного режима
    function applyHighlighting(comments, blacklist, whitelist, type) {
        comments.forEach(comment => {
            const userId = comment.href.split('/').pop();
            if (!userId) return;

            if (whitelist.includes(userId)) {
                highlightElement(comment, 'whitelist', type);
            } else if (blacklist.includes(userId)) {
                highlightElement(comment, 'blacklist', type);
            }
        });
    }

    // Применение подсветки для обоих режимов
    function applyHighlightingBoth(comments, lists) {
        comments.forEach(comment => {
            const userId = comment.href.split('/').pop();
            if (!userId) return;

            const inMyWhitelist = lists.myWhitelist.includes(userId);
            const inMyBlacklist = lists.myBlacklist.includes(userId);
            const inTheirWhitelist = lists.whitelisters.includes(userId);
            const inTheirBlacklist = lists.blacklisters.includes(userId);

            if (inMyWhitelist && inTheirWhitelist) {
                highlightElement(comment, 'whitelist', 'both-positive');
            } else if (inMyWhitelist) {
                highlightElement(comment, 'whitelist', 'my');
            } else if (inTheirWhitelist) {
                highlightElement(comment, 'whitelist', 'their');
            } else if (inMyBlacklist && inTheirBlacklist) {
                highlightElement(comment, 'blacklist', 'both-negative');
            } else if (inMyBlacklist) {
                highlightElement(comment, 'blacklist', 'my');
            } else if (inTheirBlacklist) {
                highlightElement(comment, 'blacklist', 'their');
            }
        });
    }

    // Подсветка элемента
    function highlightElement(element, listType, highlightType) {
        element.classList.add('fl-highlighted-username', `fl-${listType}-name`);

        const container = element.closest('.comment, .book-comment, .node-comment') ||
                         element.parentElement;

        if (container) {
            container.classList.add(`fl-highlight-${listType}`);
        }

        // Разные подсказки в зависимости от типа подсветки
        const titles = {
            'my': listType === 'whitelist' ? 
                'Пользователь в моём белом списке' : 
                'Пользователь в моём чёрном списке',
            'their': listType === 'whitelist' ?
                'Я в белом списке у этого пользователя' :
                'Я в чёрном списке у этого пользователя',
            'both-positive': 'Взаимный белый список',
            'both-negative': 'Взаимный чёрный список'
        };

        element.title = titles[highlightType] || titles.their;
    }

    // Установка ID вручную
    function setManualUserId() {
        const id = prompt('Введите ваш ID пользователя Flibusta:');
        if (id && /^\d+$/.test(id)) {
            GM_setValue('manual_user_id', id);
            alert(`ID ${id} сохранён! Перезагрузите страницу.`);
            location.reload();
        }
    }

    // Функции переключения режимов
    function setMyListsMode() { setHighlightMode(HIGHLIGHT_MODES.MY_LISTS); }
    function setTheirListsMode() { setHighlightMode(HIGHLIGHT_MODES.THEIR_LISTS); }
    function setBothMode() { setHighlightMode(HIGHLIGHT_MODES.BOTH); }

    // Регистрация команд меню
    function registerMenuCommands() {
        const currentMode = getHighlightMode();
        
        GM_registerMenuCommand(`Режим: Мои списки ${currentMode === HIGHLIGHT_MODES.MY_LISTS ? '✓' : ''}`, setMyListsMode);
        GM_registerMenuCommand(`Режим: Я в списках у других ${currentMode === HIGHLIGHT_MODES.THEIR_LISTS ? '✓' : ''}`, setTheirListsMode);
        GM_registerMenuCommand(`Режим: Все ${currentMode === HIGHLIGHT_MODES.BOTH ? '✓' : ''}`, setBothMode);
        GM_registerMenuCommand('---', () => {});
        GM_registerMenuCommand('Установить ID вручную', setManualUserId);
        GM_registerMenuCommand('Перезапустить скрипт', () => location.reload());
    }

    // Инициализация
    registerMenuCommands();
    
    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
})();
