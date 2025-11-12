// ==UserScript==
// @name         Flibusta Comment Highlighter
// @namespace    http://tampermonkey.net/
// @version      8.0
// @description  Подсвечивает комментарии пользователей из чёрного/белого списков
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

                    // Извлечение ID
                    const blacklisters = extractIds(doc, 4);
                    const whitelisters = extractIds(doc, 3);

                    applyHighlighting(comments, blacklisters, whitelisters);
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

    // Применение подсветки
    function applyHighlighting(comments, blacklisters, whitelisters) {
        comments.forEach(comment => {
            const userId = comment.href.split('/').pop();
            if (!userId) return;

            if (whitelisters.includes(userId)) {
                highlightElement(comment, 'whitelist');
            } else if (blacklisters.includes(userId)) {
                highlightElement(comment, 'blacklist');
            }
        });
    }

    // Подсветка элемента
    function highlightElement(element, type) {
        element.classList.add('fl-highlighted-username', `fl-${type}-name`);

        const container = element.closest('.comment, .book-comment, .node-comment') ||
                         element.parentElement;

        if (container) {
            container.classList.add(`fl-highlight-${type}`);
        }

        element.title = type === 'whitelist' ?
            'Пользователь в белом списке' :
            'Пользователь в чёрном списке';
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

    // Регистрация команд меню
    GM_registerMenuCommand('Установить ID вручную', setManualUserId);
    GM_registerMenuCommand('Перезапустить скрипт', init);

    // Запуск
    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init);
})();