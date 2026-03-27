// ==UserScript==
// @name         Krawężnik / Wykop Entry Collapser
// @license      MIT
// @namespace    https://github.com/Black-Reven/Kraweznik-Wykop-Entry-Collapser
// @version      2.1.0
// @description  Dodaje przyciski zwijania/rozwijania do wpisów na Wykop.pl, co ułatwia przeglądanie. Stan zwinięcia jest zapamiętywany między sesjami z automatycznym usuwaniem starych wpisów.
// @author       BlackReven + AI
// @match        https://wykop.pl/*
// @grant        GM_addStyle
// @icon         https://wykop.pl/favicon.ico
// @homepageURL  https://github.com/Black-Reven/Kraweznik-Wykop-Entry-Collapser
// @supportURL   https://github.com/Black-Reven/Kraweznik-Wykop-Entry-Collapser/issues
// @downloadURL  https://github.com/Black-Reven/Kraweznik-Wykop-Entry-Collapser/raw/main/Kraweznik.user.js
// @updateURL    https://github.com/Black-Reven/Kraweznik-Wykop-Entry-Collapser/raw/main/Kraweznik.user.js
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    // Stałe
    // =========================================================================

    /** @type {string} Klucz w LocalStorage używany do zapisywania ID zwiniętych wpisów */
    const STORAGE_KEY = 'wykop_collapsed_entries';

    /** @type {number} Maksymalny czas (w ms), po którym zwinięty wpis jest automatycznie usuwany z pamięci — 3 dni */
    const EXPIRY_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

    /** @type {string} Nazwa atrybutu ustawiana na wpisach, które zostały już przetworzone przez skrypt */
    const ATTR_PROCESSED = 'data-collapser-processed';

    /** @type {string} Nazwa atrybutu ustawiana na wpisach, które są obecnie zwinięte */
    const ATTR_COLLAPSED = 'data-collapser-collapsed';

    /** @type {string} Nazwa klasy CSS dla przycisku zwijania/rozwijania */
    const BTN_CLASS = 'collapser-toggle';

    /** @type {string} Znak minusa w Unicode (−) używany jako ikona "zwiń" */
    const ICON_COLLAPSE = '\u2212';

    /** @type {string} Znak plusa (+) używany jako ikona "rozwiń" */
    const ICON_EXPAND = '+';

    // =========================================================================
    // Zarządzanie Stanem — Zapisywanie Danych
    // =========================================================================

    /**
     * Przechowuje ID zwiniętych wpisów w pamięci podręcznej.
     * Mapuje ID wpisu (string) na znacznik czasu/timestamp (number) momentu jego zwinięcia.
     * Zapisywanie czasu pozwala na automatyczne usuwanie starych wpisów z pamięci.
     *
     * @type {Map<string, number>}
     */
    let collapsedEntries = new Map();

    /**
     * Wczytuje dane o zwiniętych wpisach z LocalStorage do pamięci.
     * W przypadku błędu parsowania po cichu tworzy pustą mapę.
     */
    function loadState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            collapsedEntries = new Map(parsed);
        } catch {
            collapsedEntries = new Map();
        }
    }

    /**
     * Zapisuje aktualny stan z pamięci do LocalStorage.
     */
    function saveState() {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(Array.from(collapsedEntries.entries()))
        );
    }

    // =========================================================================
    // Funkcje Pomocnicze DOM
    // =========================================================================

    /**
     * Wyodrębnia numeryczne ID wpisu z atrybutu `id` elementu.
     *
     * Wykop używa ID w formacie "entry-12345" na elementach `<section>`.
     * Ta funkcja wyciąga z niego samą część numeryczną.
     *
     * @param   {HTMLElement} element - Element `<section>` wpisu.
     * @returns {string|null} Numeryczne ID w formie stringa lub null, jeśli nie znaleziono.
     */
    function extractEntryId(element) {
        const match = element.id?.match(/\d+/);
        return match ? match[0] : null;
    }

    /**
     * Pobiera znacznik czasu (timestamp) publikacji wpisu z jego elementu `<time>`.
     *
     * @param   {HTMLElement} element - Element `<section>` wpisu.
     * @returns {number|null} Znacznik czasu w formacie Unix (w milisekundach) lub null, jeśli brak.
     */
    function getEntryTimestamp(element) {
        const timeEl = element.querySelector('time.time');
        if (!timeEl) return null;

        const datetime = timeEl.getAttribute('datetime');
        if (!datetime) return null;

        const timestamp = new Date(datetime).getTime();
        return isNaN(timestamp) ? null : timestamp;
    }

    /**
     * Określa, które elementy potomne wpisu powinny zostać ukryte po zwinięciu.
     *
     * Nagłówek wpisu (nazwa autora, awatar, data dodania) zawsze pozostaje widoczny,
     * aby użytkownik mógł zidentyfikować wpis i kliknąć przycisk rozwinięcia.
     * Cała reszta (tekst, media, komentarze, pasek akcji) zostaje ukryta.
     *
     * @param   {HTMLElement} element - Element `<section>` wpisu.
     * @returns {HTMLElement[]} Tablica elementów do pokazania/ukrycia.
     */
    function getCollapsibleContent(element) {
        // Bezpośrednie elementy <div> (np. kontener z komentarzami)
        const childDivs = Array.from(element.children).filter(
            (child) => child.tagName === 'DIV'
        );

        // Wewnątrz elementu <article>, wszystko oprócz <header>
        const article = element.querySelector('article');
        if (!article) return childDivs;

        const articleContent = Array.from(article.children).filter(
            (child) => child.tagName.toLowerCase() !== 'header'
        );

        return [...childDivs, ...articleContent];
    }

    // =========================================================================
    // Logika Zwijania / Rozwijania
    // =========================================================================

    /**
     * Zwija wpis, ukrywając jego zawartość i oznaczając go odpowiednim atrybutem danych.
     *
     * @param {HTMLElement} element - Element wpisu do zwinięcia.
     */
    function collapseEntry(element) {
        getCollapsibleContent(element).forEach((child) => {
            child.style.display = 'none';
        });
        element.setAttribute(ATTR_COLLAPSED, 'true');
    }

    /**
     * Rozwija wcześniej zwinięty wpis, przywracając widoczność jego zawartości.
     *
     * @param {HTMLElement} element - Element wpisu do rozwinięcia.
     */
    function expandEntry(element) {
        getCollapsibleContent(element).forEach((child) => {
            child.style.display = '';
        });
        element.removeAttribute(ATTR_COLLAPSED);
    }

    /**
     * Aktualizuje stan wizualny przycisku, odzwierciedlając, czy wpis jest zwinięty, czy rozwinięty.
     *
     * @param {HTMLButtonElement} button      - Element przycisku.
     * @param {boolean}           isCollapsed - Czy wpis jest aktualnie zwinięty.
     */
    function updateButtonState(button, isCollapsed) {
        if (isCollapsed) {
            button.textContent = ICON_EXPAND;
            button.classList.remove('collapser-btn-collapse');
            button.classList.add('collapser-btn-expand');
            button.setAttribute('aria-label', 'Rozwiń wpis');
            button.setAttribute('aria-expanded', 'false');
        } else {
            button.textContent = ICON_COLLAPSE;
            button.classList.remove('collapser-btn-expand');
            button.classList.add('collapser-btn-collapse');
            button.setAttribute('aria-label', 'Zwiń wpis');
            button.setAttribute('aria-expanded', 'true');
        }
    }

    // =========================================================================
    // Tworzenie Przycisku Zwijania
    // =========================================================================

    /**
     * Wstrzykuje przycisk zwijania/rozwijania do nagłówka wpisu.
     *
     * Przycisk umieszczany jest wewnątrz kontenera `.buttons` w sekcji oceniania (`rating-box`),
     * aby dopasować się do natywnego interfejsu Wykopu. Jeśli kontener nie istnieje, zostaje utworzony.
     *
     * @param {HTMLElement} entryElement - Element wpisu `<section class="entry">`.
     */
    function injectToggleButton(entryElement) {
        const header =
            entryElement.querySelector('article header') ||
            entryElement.querySelector('header');
        if (!header) return;

        const entryId = extractEntryId(entryElement);
        if (!entryId) return;

        // Zapobiega dublowaniu przycisków
        if (header.querySelector(`.${BTN_CLASS}`)) return;

        const ratingBox = header.querySelector('section.rating-box');
        if (!ratingBox) return;

        // Znajdź lub stwórz kontener na przyciski w sekcji oceniania
        let buttonsContainer = ratingBox.querySelector('div.buttons');
        if (!buttonsContainer) {
            buttonsContainer = document.createElement('div');
            buttonsContainer.className = 'buttons';
            ratingBox.appendChild(buttonsContainer);
        }

        // Stwórz przycisk zwijania/rozwijania
        const isCurrentlyCollapsed = collapsedEntries.has(entryId);
        const toggleButton = document.createElement('button');
        toggleButton.className = `${BTN_CLASS} plus`;
        toggleButton.type = 'button';
        updateButtonState(toggleButton, isCurrentlyCollapsed);

        // Obsługa kliknięcia — przełączanie stanu zwinięcia
        toggleButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();

            if (collapsedEntries.has(entryId)) {
                // Rozwiń
                collapsedEntries.delete(entryId);
                expandEntry(entryElement);
                updateButtonState(toggleButton, false);
            } else {
                // Zwiń — zapisz aktualny czas (timestamp), by śledzić czas ważności
                collapsedEntries.set(entryId, Date.now());
                collapseEntry(entryElement);
                updateButtonState(toggleButton, true);
            }

            saveState();
        });

        buttonsContainer.appendChild(toggleButton);
    }

    // =========================================================================
    // Automatyczne Usuwanie Starych Wpisów
    // =========================================================================

    /**
     * Usuwa z pamięci wpisy starsze niż ustalony próg czasowy.
     * Zapobiega to nieskończonemu rozrastaniu się danych w LocalStorage.
     *
     * Używane są dwie strategie czyszczenia:
     *   1. Jeśli element DOM wpisu jest widoczny, sprawdzana jest data jego publikacji.
     *   2. Jeśli wpisu nie ma w DOM, sprawdzany jest zapisany czas jego zwinięcia.
     */
    function purgeExpiredEntries() {
        const now = Date.now();
        let hasChanges = false;

        for (const [id, collapsedAt] of collapsedEntries) {
            let shouldRemove = false;

            // Strategia 1: Sprawdź datę publikacji wpisu pobraną z DOM
            const entryElement =
                document.getElementById(id) ||
                document.querySelector(`[id*="${id}"]`);

            if (entryElement) {
                const publishedAt = getEntryTimestamp(entryElement);
                if (publishedAt && now - publishedAt > EXPIRY_THRESHOLD_MS) {
                    shouldRemove = true;
                }
            } else if (typeof collapsedAt === 'number' && now - collapsedAt > EXPIRY_THRESHOLD_MS) {
                // Strategia 2: Wpisu nie ma w DOM — użyj zapisanego czasu zwinięcia
                shouldRemove = true;
            }

            if (shouldRemove) {
                collapsedEntries.delete(id);
                hasChanges = true;
            }
        }

        if (hasChanges) saveState();
    }

    // =========================================================================
    // Obsługa Dynamicznej Zawartości (Wsparcie dla SPA)
    // =========================================================================

    /**
     * Skanuje DOM w poszukiwaniu nowych (nieprzetworzonych) wpisów i stosuje do nich
     * odpowiedni stan (zwinięty/rozwinięty) oraz dodaje przyciski.
     *
     * Wykop jest aplikacją typu SPA (Single Page Application) — zawartość ładuje się dynamicznie,
     * więc ta funkcja wywoływana jest zarówno przy pierwszym uruchomieniu, jak i przy każdej
     * zmianie w DOM (przez MutationObserver).
     */
    function processNewEntries() {
        const entries = document.querySelectorAll('section.entry');

        entries.forEach((entryElement) => {
            // Pomiń już przetworzone wpisy
            if (entryElement.hasAttribute(ATTR_PROCESSED)) return;

            const entryId = extractEntryId(entryElement);
            if (!entryId) return;

            // Przywróć stan, jeśli wpis był wcześniej zwinięty
            if (collapsedEntries.has(entryId)) {
                const publishedAt = getEntryTimestamp(entryElement);

                if (publishedAt && Date.now() - publishedAt > EXPIRY_THRESHOLD_MS) {
                    // Czas ważności wpisu minął — usuń z pamięci zamiast zwijać
                    collapsedEntries.delete(entryId);
                    saveState();
                } else {
                    collapseEntry(entryElement);
                }
            }

            injectToggleButton(entryElement);
            entryElement.setAttribute(ATTR_PROCESSED, 'true');
        });
    }

    // =========================================================================
    // Style CSS
    // =========================================================================

    /**
     * Wstrzykuje style CSS odpowiedzialne za animację zwijania oraz wygląd przycisku.
     */
    function injectStyles() {
        GM_addStyle(`
            /* --- Wygląd zwiniętego wpisu --- */
            section.entry[${ATTR_COLLAPSED}] {
                overflow: hidden;
                height: 48px;
                opacity: 0.65;
                transition: height 0.3s ease, opacity 0.3s ease;
            }

            /* --- Główne style przycisku --- */
            .${BTN_CLASS} {
                min-width: 46px !important;
                padding: 0 16px !important;
                margin-left: 10px !important;
                font-size: 17px !important;
                font-weight: bold !important;
                line-height: 28px !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                cursor: pointer !important;
                border: none !important;
                background: transparent !important;
                transition: filter 0.2s ease !important;
            }

            .${BTN_CLASS}:hover {
                filter: brightness(1.15);
            }

            /* --- Kolor tekstu/ikony przycisku dla obu stanów --- */
            .${BTN_CLASS}.collapser-btn-collapse,
            .${BTN_CLASS}.collapser-btn-expand {
                color: #fff !important;
            }

            /* --- Zapewnij pionowe wyśrodkowanie przycisku obok licznika plusów --- */
            .rating-box > div.buttons {
                display: flex !important;
                align-items: center !important;
            }
        `);
    }

    // =========================================================================
    // Inicjalizacja
    // =========================================================================

    /**
     * Uruchamia skrypt:
     *  1. Wczytuje zapisany stan z LocalStorage.
     *  2. Usuwa wygasłe wpisy z pamięci.
     *  3. Przetwarza wpisy już obecne w DOM.
     *  4. Uruchamia MutationObserver dla treści ładowanych dynamicznie.
     *  5. Wstrzykuje wymagane style CSS.
     */
    function initialize() {
        loadState();
        purgeExpiredEntries();
        processNewEntries();
        injectStyles();

        // Obserwuj mutacje w DOM, aby obsługiwać wpisy ładowane dynamicznie (nawigacja SPA)
        const observer = new MutationObserver(processNewEntries);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    initialize();
})();
