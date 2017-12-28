// ==UserScript==
// @description Memrise Provide Audio.
// @downloadURL https://github.com/letitend/memrise-provide-audio/raw/master/memrise-provide-audio.user.js
// @grant       none
// @match       https://www.memrise.com/course/*/garden/*
// @match       https://www.memrise.com/garden/review/*
// @name        Memrise Provide Audio
// @namespace   https://github.com/letitend
// @updateURL   https://github.com/letitend/memrise-provide-audio/raw/master/memrise-provide-audio.user.js
// @version     0.0.1
// ==/UserScript==

$(document).ready(function() {
    var cachedAudioElements = [],
        courseId,
        currentWord,
        language,
        linkHtml = $([
            "<a id='provide-audio-link'>Audio Provider</a>",
            "<div id='provide-audio-box' style='display:none'>",
            "   <em style='font-size:85%'>audio for this course:",
            "   </em><select id='provide-audio-options'></select>",
            "   <hr/>",
            "   <em style='font-size:85%'>Voice RSS key:",
            "   <input id='provide-audio-voicerss' type='text' placeholder='enter Voice RSS key'>",
            "</div>"
        ].join("\n")),
        localStorageIdentifier = "memrise-provide-audio-storagev2",
        localStorageVoiceRssIdentifier = "memrise-provide-audio-voicerss",
        referrerState,
        requestCount = 0,
        savedChoices = JSON.parse(localStorage.getItem(localStorageIdentifier)) || {},
        speechSynthesisPlaying,
        speechSynthesisUtterance = window.speechSynthesis && new window.SpeechSynthesisUtterance(),
        voiceRssKey = localStorage.getItem(localStorageVoiceRssIdentifier) || "",
        wordColumn;

    var canSpeechSynthesize = false,
        canGoogleTts = true,
        canVoiceRss = !!voiceRssKey;

    $('#left-area').append(linkHtml);
    $('#provide-audio-link').click(function() {
        $('#provide-audio-box').toggle();
    });
    $('#provide-audio-voicerss').val(voiceRssKey);
    $('#provide-audio-voicerss').change(function() {
        localStorage.setItem(localStorageVoiceRssIdentifier, $(this).val());
    });

    var meta = document.createElement('meta');
    meta.name = "referrer";
    meta.content = "origin";
    document.getElementsByTagName('head')[0].appendChild(meta);

    MEMRISE.garden.boxes.load = (function() {
        var cached_function = MEMRISE.garden.boxes.load;
        return function() {
            var result = cached_function.apply(this, arguments);
            language = MEMRISE.garden.session.category.name;
            if (speechSynthesisUtterance) {
                var langCode = speechSynthesisLanguageCodes[language];
                speechSynthesisUtterance.lang = langCode || "";
                speechSynthesisUtterance.voice = speechSynthesis.getVoices().filter(function(voice) {
                    return voice.lang === langCode;
                })[0];
                canSpeechSynthesize = !!(speechSynthesisUtterance.lang && speechSynthesisUtterance.voice);
            }

            MEMRISE.garden.session.make_box = (function() {
                var cached_function = MEMRISE.garden.session.make_box;
                return function() {
                    var result = cached_function.apply(this, arguments);
                    if (["end_of_session", "speed-count-down"].indexOf(result.template) < 0) {
                        var newCourseId = getCourseId(result);
                        if (courseId !== newCourseId) {
                            courseId = newCourseId;
                            wordColumn = savedChoices[courseId] || _.map(_.filter([result.learnable.item, result.learnable.definition], x => x.kind === "text"), x => x.label)[0] || "No audio";
                            editAudioOptions(result);
                        }
                        if (wordColumn !== "No audio") {
                            var isInjected = injectAudioIfRequired(result);
                            currentWord = _.find([result.learnable.definition, result.learnable.item], x => x.label === wordColumn).value;
                            if (isInjected && currentWord && !canSpeechSynthesize && canGoogleTts) {
                                getGoogleTtsElement(currentWord);
                            }
                        }
                    }
                    return result;
                };
            }());

            MEMRISE.renderer.fixMediaUrl = (function() {
                var cached_function = MEMRISE.renderer.fixMediaUrl;
                return function() {
                    if (arguments[0] === "AUDIO_PROVIDER" || (_.isArray(arguments[0]) && arguments[0][0] === "AUDIO_PROVIDER")) {
                        return "";
                    } else {
                        return cached_function.apply(this, arguments);
                    }
                };
            }());

            MEMRISE.audioPlayer.play = (function() {
                var cached_function = MEMRISE.audioPlayer.play;
                return function() {
                    var shouldGenerateAudio = (arguments[0].url === "");
                    if (shouldGenerateAudio) {
                        playGeneratedAudio(currentWord);
                    } else {
                        cached_function.apply(this, arguments);
                    }
                };
            }());

            return result;
        };
    }());

    function editAudioOptions(context) {
        $('#provide-audio-options').empty();
        var options = ["No audio"].concat([context.learnable.definition, context.learnable.item].filter(x => x.kind === "text").map(x => x.label));
        _.each(options, o => $('#provide-audio-options').append('<option value="' + o + '">' + o + '</option>'));
        $('#provide-audio-options').val(wordColumn);
        $('#provide-audio-options').change(function() {
            wordColumn = $(this).val();
            savedChoices[courseId] = wordColumn;
            localStorage.setItem(localStorageIdentifier, JSON.stringify(savedChoices));
            if (wordColumn !== "No audio") {
                currentWord = _.find([context.learnable.definition, context.learnable.item], x => x.label === wordColumn).value;
            }
        });
    }

    function getCachedElement(source, word) {
        var cachedElem = cachedAudioElements.find(function(obj) {
            return obj.source === source && obj.word === word;
        });
        return cachedElem && cachedElem.element;
    }

    function removeCachedElement(source, word) {
        _.remove(cachedAudioElements, e => e.source === source && e.word === word);
    }

    function setCachedElement(source, word, element) {
        cachedAudioElements.push({
            source: source,
            word: word,
            element: element
        });
    }

    function getCourseId(context) {
        return context.course_id || MEMRISE.garden.session_params.course_id || MEMRISE.garden.session_data.things_to_courses[context.thinguser.thing_id];
    }

    function injectAudioIfRequired(context) {
        if (canSpeechSynthesize || canGoogleTts || canVoiceRss) {
            $('#provide-audio-link').show();
            if(!context.learnable.audios.length) {
                context.learnable.audios = MEMRISE.garden.screens[context.learnable_id].presentation.audio = ["AUDIO_PROVIDER"];
                return true;
            }
        } else {
            $('#provide-audio-link').hide();
        }
    }

    function playGeneratedAudio(word) {
        if (canSpeechSynthesize) {
            playSpeechSynthesisAudio(word);
        } else if (canGoogleTts) {
            playGoogleTtsAudio(word);
        } else if (canVoiceRss) {
            playVoiceRssAudio(word);
        }
    }

    function playSpeechSynthesisAudio(word) {
        if (!speechSynthesisPlaying) {
            speechSynthesisUtterance.text = word;
            window.speechSynthesis.speak(speechSynthesisUtterance);
            speechSynthesisPlaying = true;
            speechSynthesisUtterance.onend = function(event) {
                speechSynthesisPlaying = false;
                if (navigator.userAgent.search("Firefox") > -1) {
                    var lang = speechSynthesisUtterance.lang,
                        voice = speechSynthesisUtterance.voice,
                        test = speechSynthesisUtterance.text;
                    speechSynthesisUtterance = new window.SpeechSynthesisUtterance();
                    speechSynthesisUtterance.lang = lang;
                    speechSynthesisUtterance.voice = voice;
                    speechSynthesisUtterance.text = text;
                }
            };
        }
    }

    function playGoogleTtsAudio(word) {
        getGoogleTtsElement(word, audioElement => audioElement.play());
    }

    function getGoogleTtsElement(word, callback) {
        var languageCode = googleTtsLanguageCodes[language],
            source = "google tts",
            cachedElement = getCachedElement(source, word);

        if (languageCode) {
            if (cachedElement) {
                if (callback)
                    callback(cachedElement);
            } else {
                if (isNetworkBusy()) {
                    setTimeout(function() {
                        getGoogleTtsElement(word, callback);
                    }, 300);
                } else {
                    var url = "https://translate.google.com/translate_tts?ie=UTF-8&tl=" + languageCode + "&client=tw-ob&q=" + encodeURIComponent(word) + "&tk=" + Math.floor(Math.random() * 1000000); //helps stop google from complaining about too many requests;
                    var audioElement = makeAudioElement(source, word, url, function(e) {
                        if (referrerState === "origin") {
                            removeCachedElement(source, word);
                        } else {
                            canGoogleTts = false;
                            setReferrerOrigin();
                        }
                    });
                    if (navigator.userAgent.search("Firefox") > -1) {
                        $(audioElement).on('loadstart', () => setReferrerNoReferrer());
                    } else {
                        setReferrerNoReferrer();
                    }
                    $(audioElement).on('loadedmetadata', () => setReferrerOrigin());
                    if (callback)
                        callback(audioElement);
                }
            }
        }
    }

    function setReferrerOrigin() {
        document.getElementsByName("referrer")[0].setAttribute("content", "origin");
        referrerState = "origin";
    }

    function setReferrerNoReferrer() {
        document.getElementsByName("referrer")[0].setAttribute("content", "no-referrer");
        referrerState = "no-referrer";
    }

    function playVoiceRssAudio(word) {
        var audioElement = getVoiceRssElement(word);
        if (audioElement) {
            audioElement.play();
        } else {
            canVoiceRss = false;
            playGeneratedAudio(word);
        }
    }

    function getVoiceRssElement(word) {
        var languageCode = voiceRssLanguageCodes[language],
            source = "voice rss",
            cachedElement = getCachedElement(source, word);

        if (languageCode) {
            if (cachedElement) {
                return cachedElement;
            } else {
                var url = 'https://api.voicerss.org/?key=' + voiceRssKey + '&src=' + encodeURIComponent(word) + '&hl=' + languageCode + '&f=48khz_16bit_stereo';
                return makeAudioElement(source, word, url, function(e) {
                    canVoiceRss = false;
                });
            }
        }
    }

    function makeAudioElement(source, word, url, onError) {
        var audioElement = document.createElement('audio');
        audioElement.setAttribute('src', url);
        $(audioElement).on('error', function(e) {
            onError(e);
            playGeneratedAudio(word);
        });
        setCachedElement(source, word, audioElement);
        return audioElement;
    }

    function isNetworkBusy() {
        return requestCount > 0;
    }

    $(document).ajaxSend(function(e, xhr, settings) {
        requestCount++;
        if (referrerState === "no-referrer") {
            setReferrerOrigin();
        }
        xhr.always(function() {
            requestCount--;
        });
    });

    var speechSynthesisLanguageCodes = {
        "German": "de-DE",
        "English": "en-GB",
        "Spanish (Mexico)": "es-ES",
        "Spanish (Spain)": "es-ES",
        "French": "fr-FR",
        "Hindi": "hi-IN",
        "Indonesian": "id-ID",
        "Italian": "it-IT",
        "Japanese": "ja-JP",
        "Korean": "ko-KR",
        "Dutch": "nl-NL",
        "Polish": "pl-PL",
        "Portuguese (Brazil)": "pt-BR",
        "Russian": "ru-RU",
        "Chinese (Simplified)": "zh-CN",
        "Cantonese": "zh-HK",
        "Chinese (Traditional)": "zh-TW"
    };

    var googleTtsLanguageCodes = {
        "Afrikaans": "af",
        "Albanian": "sq",
        "Arabic": "ar",
        "Armenian": "hy",
        "Bengali": "bn",
        "Bosnian": "bs",
        "Catalan": "ca",
        "Chinese (Simplified)": "zh-CN",
        "Chinese (Traditional)": "zh-TW",
        "Croatian": "hr",
        "Czech": "cs",
        "Danish": "da",
        "Dutch": "nl",
        "English": "en",
        "Esperanto": "eo",
        "Finnish": "fi",
        "French": "fr",
        "German": "de",
        "Greek": "el",
        "Hindi": "hi",
        "Hungarian": "hu",
        "Icelandic": "is",
        "Indonesian": "id",
        "Italian": "it",
        "Japanese": "ja",
        "Khmer": "km",
        "Korean": "ko",
        "Latin": "la",
        "Latvian": "lv",
        "Macedonian": "mk",
        "Nepali": "ne",
        "Norwegian": "no",
        "Polish": "pl",
        "Portuguese (Brazil)": "pt-BR",
        "Portuguese (Portugal)": "pt-PT",
        "Romanian": "ro",
        "Russian": "ru",
        "Serbian": "sr",
        "Sinhalese": "si",
        "Slovak": "sk",
        "Spanish (Mexico)": "es",
        "Spanish (Spain)": "es",
        "Swahili": "sw",
        "Swedish": "sv",
        "Tamil": "ta",
        "Thai": "th",
        "Turkish": "tr",
        "Ukrainian": "uk",
        "Vietnamese": "vi",
        "Welsh": "cy"
    };

    var voiceRssLanguageCodes = {
        "Catalan": "ca-es",
        "Chinese (Simplified)": "zh-cn",
        "Chinese (Traditional)": "zh-tw",
        "Danish": "da-dk",
        "Dutch": "nl-nl",
        "English": "en-gb",
        "fi-fi": "fi",
        "French": "fr-fr",
        "German": "de-de",
        "Italian": "it-it",
        "Japanese": "ja-jp",
        "Korean": "ko-kr",
        "Norwegian": "nb-no",
        "Polish": "pl-pl",
        "Portuguese (Brazil)": "pt-br",
        "Portuguese (Portugal)": "pt-pt",
        "Russian": "ru-ru",
        "Spanish (Mexico)": "es-es",
        "Spanish (Spain)": "es-es",
        "Swedish": "sv-se"
    };
});