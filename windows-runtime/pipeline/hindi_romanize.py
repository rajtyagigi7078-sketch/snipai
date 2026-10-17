"""
Offline Hindi-script-to-Roman transliteration for Snip AI.

Supports Devanagari and Urdu/Arabic-script Hindi output from Whisper. This changes
the writing script, not the spoken language. Latin/English text is preserved.
"""

import re

CONSONANTS = {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ng",
    "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "ny",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
    "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
    "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh",
    "ष": "sh", "स": "s", "ह": "h", "ळ": "l",
}

NUKTA_CONSONANTS = {
    "क": "q", "ख": "kh", "ग": "gh", "ज": "z",
    "ड": "r", "ढ": "rh", "फ": "f", "य": "y",
}

INDEPENDENT_VOWELS = {
    "अ": "a", "आ": "aa", "इ": "i", "ई": "i",
    "उ": "u", "ऊ": "oo", "ऋ": "ri", "ॠ": "ri",
    "ऌ": "li", "ए": "e", "ऐ": "ai", "ओ": "o",
    "औ": "au",
}

VOWEL_SIGNS = {
    "ा": "aa", "ि": "i", "ी": "i", "ु": "u", "ू": "oo",
    "ृ": "ri", "ॄ": "ri", "ॢ": "li", "े": "e", "ै": "ai",
    "ो": "o", "ौ": "au",
}

VIRAMA = "्"
NUKTA = "़"
NASAL_MARKS = {"ं", "ँ"}
IGNORABLE = {"\u200c", "\u200d", "\ufeff"}
DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")
ARABIC_SCRIPT_RE = re.compile(r"[\u0600-\u06FF]")

# Whisper sometimes emits Hindi/Urdu speech in Urdu script even when the detected
# language is "hi". These common-word spellings make the resulting Roman text
# natural for Hindi/Hinglish captions; the fallback below handles other words.
URDU_WORD_OVERRIDES = {
    "میری": "meri", "میرا": "mera", "میرے": "mere", "میری": "meri",
    "پیچھے": "peechhe", "پچھلے": "pichhle", "پہلے": "pehle",
    "سوگ": "sog", "کارب": "karb", "سے": "se", "اور": "aur",
    "اگر": "agar", "دن": "din", "ختم": "khatam", "ہونے": "hone",
    "ہمیں": "humein", "ہم": "hum", "میں": "mein", "تو": "to",
    "انہیں": "unhein", "انھیں": "unhein", "پانچ": "paanch",
    "لوگ": "log", "کالس": "calls", "لیں": "lein", "گے": "ge",
    "پر": "par", "ہم": "hum", "بچ": "bach", "نکلیں": "niklein",
    "کچھ": "kuchh", "نہیں": "nahi", "شروع": "shuru", "گیا": "gaya",
    "جہاں": "jahan", "وہاں": "wahan", "رہا": "raha", "رہے": "rahe",
    "رہی": "rahi", "کر": "kar", "کیا": "kya", "ہے": "hai",
    "ہیں": "hain", "ہوں": "hoon", "ہو": "ho", "ہونا": "hona",
    "ہوتا": "hota", "ہوتی": "hoti", "تھا": "tha", "تھی": "thi",
    "تھے": "the", "آپ": "aap", "یہ": "yeh", "وہ": "woh",
    "اس": "is", "اسے": "ise", "اپنے": "apne", "اپنا": "apna",
    "بہت": "bahut", "اچھا": "achha", "اچھے": "achhe",
    "آج": "aaj", "اب": "ab", "کی": "ki", "کا": "ka", "کے": "ke",
    "کو": "ko", "پر": "par", "بعد": "baad", "بات": "baat",
    "نام": "naam", "آئے": "aaye", "آیا": "aaya", "لیے": "liye",
    "لیا": "liya", "دیکھیں": "dekhein", "دیکھو": "dekho",
}

# Approximate Urdu orthography fallback. Short vowels are normally omitted in
# Urdu writing, so exact colloquial Hinglish spelling is inherently ambiguous.
URDU_LETTERS = {
    "ا": "a", "آ": "aa", "ب": "b", "پ": "p", "ت": "t", "ٹ": "t",
    "ث": "s", "ج": "j", "چ": "ch", "ح": "h", "خ": "kh", "د": "d",
    "ڈ": "d", "ذ": "z", "ر": "r", "ڑ": "r", "ز": "z", "ژ": "zh",
    "س": "s", "ش": "sh", "ص": "s", "ض": "z", "ط": "t", "ظ": "z",
    "ع": "", "غ": "gh", "ف": "f", "ق": "q", "ک": "k", "گ": "g",
    "ل": "l", "م": "m", "ن": "n", "ں": "n", "و": "o", "ہ": "h",
    "ھ": "h", "ء": "", "ئ": "i", "ی": "i", "ے": "e", "ؤ": "o",
    "ۓ": "e", "ۃ": "h", "ة": "h", "ٱ": "a", "ى": "a",
    "َ": "a", "ِ": "i", "ُ": "u", "ٰ": "a", "ّ": "",
    "ْ": "", "ٔ": "", "ٕ": "", "ـ": "",
}
ARABIC_DIACRITICS_RE = re.compile(r"[\u064B-\u065F\u0670]")



def _romanize_word(word: str) -> str:
    # Common nasalized e is conventionally written "mein" as a standalone word.
    if word == "में":
        return "mein"

    chars = list(word)
    units = []
    i = 0

    while i < len(chars):
        ch = chars[i]

        if ch in IGNORABLE:
            i += 1
            continue

        if ch in CONSONANTS:
            consonant = CONSONANTS[ch]
            if i + 1 < len(chars) and chars[i + 1] == NUKTA:
                consonant = NUKTA_CONSONANTS.get(ch, consonant)
                i += 1

            if i + 1 < len(chars) and chars[i + 1] in VOWEL_SIGNS:
                vowel_sign = chars[i + 1]
                units.append({
                    "text": consonant + VOWEL_SIGNS[vowel_sign],
                    "consonant": True,
                    "inherent": False,
                    "explicit_vowel": vowel_sign,
                    "independent_vowel": False,
                })
                i += 2
                continue

            if i + 1 < len(chars) and chars[i + 1] == VIRAMA:
                units.append({
                    "text": consonant,
                    "consonant": True,
                    "inherent": False,
                    "explicit_vowel": None,
                    "independent_vowel": False,
                })
                i += 2
                continue

            next_char = chars[i + 1] if i + 1 < len(chars) else ""
            has_inherent_a = bool(next_char and next_char in CONSONANTS)
            units.append({
                "text": consonant + ("a" if has_inherent_a else ""),
                "consonant": True,
                "inherent": has_inherent_a,
                "explicit_vowel": None,
                "independent_vowel": False,
            })
            i += 1
            continue

        if ch in INDEPENDENT_VOWELS:
            units.append({
                "text": INDEPENDENT_VOWELS[ch],
                "consonant": False,
                "inherent": False,
                "explicit_vowel": None,
                "independent_vowel": True,
            })
        elif ch in VOWEL_SIGNS:
            units.append({
                "text": VOWEL_SIGNS[ch],
                "consonant": False,
                "inherent": False,
                "explicit_vowel": None,
                "independent_vowel": True,
            })
        elif ch in NASAL_MARKS:
            units.append({
                "text": "n",
                "consonant": False,
                "inherent": False,
                "explicit_vowel": None,
                "independent_vowel": False,
            })
        elif ch == "ः":
            units.append({
                "text": "h", "consonant": False, "inherent": False,
                "explicit_vowel": None, "independent_vowel": False,
            })
        elif ch in {"।", "॥"}:
            units.append({
                "text": ".", "consonant": False, "inherent": False,
                "explicit_vowel": None, "independent_vowel": False,
            })
        elif ch == "ॐ":
            units.append({
                "text": "om", "consonant": False, "inherent": False,
                "explicit_vowel": None, "independent_vowel": False,
            })
        elif ch in {VIRAMA, NUKTA}:
            pass
        else:
            units.append({
                "text": ch, "consonant": False, "inherent": False,
                "explicit_vowel": None, "independent_vowel": False,
            })
        i += 1

    # Remove many common Hindi schwas (e.g. karana -> karna, bolana -> bolna)
    # when an internal inherent 'a' precedes a consonant carrying a vowel sign.
    consonant_positions = [
        idx for idx, unit in enumerate(units) if unit["consonant"]
    ]
    first_consonant = consonant_positions[0] if consonant_positions else None
    for idx, unit in enumerate(units):
        if not unit["inherent"] or not unit["text"].endswith("a"):
            continue
        next_consonant = next(
            (
                later for later in range(idx + 1, len(units))
                if units[later]["consonant"]
            ),
            None,
        )
        if next_consonant is None:
            continue
        next_unit = units[next_consonant]
        if next_unit["explicit_vowel"] is None:
            continue
        has_vowel_before = any(
            prior["independent_vowel"] for prior in units[:idx]
        )
        if idx != first_consonant or has_vowel_before:
            unit["text"] = unit["text"][:-1]
            unit["inherent"] = False

    # Casual Roman Hinglish often uses a single "a" in words ending in
    # the long-aa matra (ja, raha, karna, batana), but keeps aa before a
    # final consonant (baat, naam). Independent long vowels such as "आ"
    # remain "aa".
    if units and units[-1].get("explicit_vowel") == "ा":
        for unit in units:
            if unit.get("explicit_vowel") == "ा" and unit["text"].endswith("aa"):
                unit["text"] = unit["text"][:-2] + "a"

    return "".join(unit["text"] for unit in units)


def romanize_devanagari(text: str) -> str:
    """Romanize Devanagari words while leaving Latin/English text untouched."""
    if not isinstance(text, str) or not text or not DEVANAGARI_RE.search(text):
        return text

    # Keep punctuation/spacing as-is; transliterate only tokens containing
    # Devanagari. Unicode word tokens may include both Latin and Devanagari.
    tokens = re.findall(r"[\w\u0900-\u097F]+|[^\w\u0900-\u097F]+", text, flags=re.UNICODE)
    return "".join(
        _romanize_word(token) if DEVANAGARI_RE.search(token) else token
        for token in tokens
    )


def romanize_urdu_word(word: str) -> str:
    """Approximate Urdu-script transcription as readable Roman Hindi/Hinglish."""
    if word in URDU_WORD_OVERRIDES:
        return URDU_WORD_OVERRIDES[word]

    normalized = ARABIC_DIACRITICS_RE.sub("", word).replace("ـ", "")
    out = []
    chars = list(normalized)
    for i, ch in enumerate(chars):
        if ch in {"و", "ؤ"}:
            # Long-vowel waw often represents oo/u after h/m/n, otherwise o/w.
            prev = chars[i - 1] if i else ""
            nxt = chars[i + 1] if i + 1 < len(chars) else ""
            if prev in {"ہ", "ھ", "م", "ن", "ب", "پ", "ت", "د", "ر", "س", "ک", "گ", "ل"}:
                out.append("oo" if prev in {"ہ", "ھ", "م", "ن"} else "o")
            elif not nxt:
                out.append("o")
            else:
                out.append("w")
        elif ch == "ی":
            # Urdu yeh commonly marks ee/i, but is consonantal word-initially.
            prev = chars[i - 1] if i else ""
            out.append("y" if not prev or prev in {"ا", "آ", "و", "ے"} else "i")
        else:
            out.append(URDU_LETTERS.get(ch, ch))
    return "".join(out)


def romanize_hinglish(text: str) -> str:
    """Romanize Devanagari or Urdu-script words; preserve existing Latin text."""
    if not isinstance(text, str) or not text:
        return text
    if DEVANAGARI_RE.search(text):
        return romanize_devanagari(text)
    if not ARABIC_SCRIPT_RE.search(text):
        return text
    tokens = re.findall(
        r"[\w\u0900-\u097F\u0600-\u06FF]+|[^\w\u0900-\u097F\u0600-\u06FF]+",
        text, flags=re.UNICODE,
    )
    return "".join(
        romanize_urdu_word(token) if ARABIC_SCRIPT_RE.search(token) else token
        for token in tokens
    )
