// ==UserScript==
// @name         Flibusta Comment Highlighter
// @namespace    http://tampermonkey.net/
// @version      8.7
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
            blacklist: '#f754e1'
        },
        maxRetries: 3,
        retryDelay: 2000
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
            background: linear-gradient(90deg, ${config.highlightColors.whitelist}20, transparent) !important;
        }
        .fl-highlight-blacklist {
            background: linear-gradient(90deg, ${config.highlightColors.blacklist}20, transparent) !important;
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
        /* Стили для впечатлений на главной */
        .container_highlight-whitelist {
            background: linear-gradient(90deg, ${config.highlightColors.whitelist}15, transparent) !important;
        }
        .container_highlight-blacklist {
            background: linear-gradient(90deg, ${config.highlightColors.blacklist}15, transparent) !important;
        }
    `);

    // Система логирования
    function log(...args) {
        if (config.debug) {
            console.log('[Flibusta Highlighter]', ...args);
        }
    }

    // Функция повторных попыток
    function withRetry(fn, context, retries = config.maxRetries) {
        return function(...args) {
            const execute = (attempt = 1) => {
                return fn.apply(context, args).catch(error => {
                    if (attempt <= retries) {
                        log(`Попытка ${attempt}/${retries} не удалась. Повтор через ${config.retryDelay}мс:`, error);
                        return new Promise(resolve => {
                            setTimeout(() => resolve(execute(attempt + 1)), config.retryDelay);
                        });
                    }
                    throw error;
                });
            };
            return execute();
        };
    }

    // Основная функция
    function init() {
        log('Скрипт запущен');
        log(`Текущий режим: ${getHighlightMode()}`);

        // Обрабатываем существующие комментарии
        processPage();
    }

    // Обработка страницы
    function processPage() {
        // Ищем обычные комментарии (ссылки на профили)
        const profileComments = document.querySelectorAll(`
            div.author-name > a[href^="/user/"],
            div.submitted > a[href^="/user/"],
            .comment-author a[href^="/user/"],
            .username a[href^="/user/"],
            .author-pane-line a[href^="/user/"],
            .post-info a[href^="/user/"]
        `);

        // Ищем впечатления на главной (ссылки на полки пользователей)
        const polkaComments = document.querySelectorAll(`
            #block-librusec-polka a[href^="/polka/show/"]
        `);

        // Ищем впечатления на странице /polka/show/all
        const polkaPageComments = document.querySelectorAll(`
            span[class^="container_"] b a[href^="/polka/show/"],
            .container_comment b a[href^="/polka/show/"]
        `);

        const allComments = [...profileComments, ...polkaComments, ...polkaPageComments];

        if (allComments.length === 0) {
            log('Комментарии не найдены');
            return;
        }

        log(`Найдено элементов: профилей=${profileComments.length}, полок боковой панели=${polkaComments.length}, полок страницы=${polkaPageComments.length}, всего=${allComments.length}`);

        // Получение ID пользователя с повторными попытками
        getUserIdWithRetry().then(userId => {
            if (!userId) {
                log('ID пользователя не найден');
                return;
            }
            processBWListsWithRetry(userId, allComments);
        }).catch(error => {
            log('Критическая ошибка при получении ID:', error);
        });
    }

    // Получение ID пользователя с повторными попытками
    const getUserIdWithRetry = withRetry(getUserId, null);

    // Получение ID пользователя
    function getUserId() {
        return new Promise((resolve, reject) => {
            // Ручной ввод
            const manualId = GM_getValue('manual_user_id');
            if (manualId) {
                log('Используется ручной ID:', manualId);
                return resolve(manualId);
            }

            log('Автоматическое определение ID...');
            // Автоматическое определение
            GM_xmlhttpRequest({
                method: 'GET',
                url: '/user/me',
                onload: function(response) {
                    if (response.status !== 200) {
                        reject(new Error(`HTTP ${response.status}: Не удалось получить страницу профиля`));
                        return;
                    }

                    try {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(response.responseText, 'text/html');
                        const bwListLink = doc.querySelector('a[href^="/bwlist"]');
                        if (bwListLink) {
                            const userId = bwListLink.href.split('/').pop();
                            log('Автоматически определен ID:', userId);
                            resolve(userId);
                        } else {
                            reject(new Error('Ссылка на bwlist не найдена'));
                        }
                    } catch (error) {
                        reject(new Error(`Ошибка при разборе страницы профиля: ${error.message}`));
                    }
                },
                onerror: function(error) {
                    reject(new Error(`Ошибка сети при получении ID: ${error}`));
                }
            });
        });
    }

    // Обработка списков с повторными попытками
    const processBWListsWithRetry = withRetry(processBWLists, null);

    // Обработка списков
    function processBWLists(userId, comments) {
        return new Promise((resolve, reject) => {
            log(`Запрос списков для пользователя ${userId}...`);

            GM_xmlhttpRequest({
                method: 'GET',
                url: `/bwlist/show/${userId}`,
                onload: function(response) {
                    log(`Получен ответ со статусом: ${response.status}`);

                    // Обрабатываем серверные ошибки
                    if (response.status >= 500) {
                        reject(new Error(`Серверная ошибка ${response.status}`));
                        return;
                    }

                    if (response.status !== 200) {
                        reject(new Error(`HTTP ${response.status}: Ошибка загрузки списков`));
                        return;
                    }

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

                        log(`Подсветка применена к ${comments.length} элементам`);
                        resolve();
                    } catch (error) {
                        reject(new Error(`Ошибка обработки списков: ${error.message}`));
                    }
                },
                onerror: function(error) {
                    reject(new Error(`Ошибка сети при запросе списков: ${error}`));
                },
                ontimeout: function() {
                    reject(new Error('Таймаут при запросе списков'));
                }
            });
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
        let highlightedCount = 0;

        comments.forEach(comment => {
            let userId;

            // Определяем ID пользователя в зависимости от типа ссылки
            if (comment.href.includes('/user/')) {
                userId = comment.href.split('/').pop();
            } else if (comment.href.includes('/polka/show/')) {
                userId = comment.href.split('/').pop();
            }

            if (!userId) return;

            if (whitelist.includes(userId)) {
                highlightElement(comment, 'whitelist', type);
                highlightedCount++;
            } else if (blacklist.includes(userId)) {
                highlightElement(comment, 'blacklist', type);
                highlightedCount++;
            }
        });

        log(`Подсвечено ${highlightedCount} пользователей в режиме ${type}`);
    }

    // Применение подсветки для обоих режимов
    function applyHighlightingBoth(comments, lists) {
        let highlightedCount = 0;

        comments.forEach(comment => {
            let userId;

            // Определяем ID пользователя в зависимости от типа ссылки
            if (comment.href.includes('/user/')) {
                userId = comment.href.split('/').pop();
            } else if (comment.href.includes('/polka/show/')) {
                userId = comment.href.split('/').pop();
            }

            if (!userId) return;

            const inMyWhitelist = lists.myWhitelist.includes(userId);
            const inMyBlacklist = lists.myBlacklist.includes(userId);
            const inTheirWhitelist = lists.whitelisters.includes(userId);
            const inTheirBlacklist = lists.blacklisters.includes(userId);

            if (inMyWhitelist && inTheirWhitelist) {
                highlightElement(comment, 'whitelist', 'both-positive');
                highlightedCount++;
            } else if (inMyWhitelist) {
                highlightElement(comment, 'whitelist', 'my');
                highlightedCount++;
            } else if (inTheirWhitelist) {
                highlightElement(comment, 'whitelist', 'their');
                highlightedCount++;
            } else if (inMyBlacklist && inTheirBlacklist) {
                highlightElement(comment, 'blacklist', 'both-negative');
                highlightedCount++;
            } else if (inMyBlacklist) {
                highlightElement(comment, 'blacklist', 'my');
                highlightedCount++;
            } else if (inTheirBlacklist) {
                highlightElement(comment, 'blacklist', 'their');
                highlightedCount++;
            }
        });

        log(`Подсвечено ${highlightedCount} пользователей в комбинированном режиме`);
    }

    // Подсветка элемента
    function highlightElement(element, listType, highlightType) {
        element.classList.add('fl-highlighted-username', `fl-${listType}-name`);

        // Для впечатлений на главной странице и странице /polka/show/all
        if (element.href.includes('/polka/show/')) {
            let container = element.closest('[class^="container_"]');
            
            // Если на странице впечатлений
            if (!container && element.closest('span[class^="container_"]')) {
                container = element.closest('span[class^="container_"]');
            }
            
            if (container) {
                container.classList.add(`fl-highlight-${listType}`);
                // Также добавляем специальный класс для контейнеров впечатлений
                container.classList.add(`container_highlight-${listType}`);
            }
        } else {
            // Для обычных комментариев и форумных комментариев
            let container = element.closest('.comment, .book-comment, .node-comment, .node, .forum-post, .indented, .forum-post-wrapper');
            
            // Если не нашли стандартный контейнер, ищем родительский элемент с определенными классами
            if (!container) {
                container = element.closest('.author-pane, .post-info, .forum-post');
            }
            
            // Если всё еще не нашли, используем родительский элемент
            if (!container) {
                container = element.parentElement;
            }

            if (container) {
                container.classList.add(`fl-highlight-${listType}`);
                
                // Для форумных комментариев дополнительно подсвечиваем основной контейнер
                const forumPost = container.closest('.forum-post');
                if (forumPost && !forumPost.classList.contains(`fl-highlight-${listType}`)) {
                    forumPost.classList.add(`fl-highlight-${listType}`);
                }
            }
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

    // Запускаем после полной загрузки страницы
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // Если страница уже загружена, ждем немного для стабильности
        setTimeout(init, 100);
    }
})();
