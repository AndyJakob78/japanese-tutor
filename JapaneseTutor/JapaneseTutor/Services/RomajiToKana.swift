import Foundation

// MARK: - Romaji → hiragana for the speech voice (2026-11-11)
// The Japanese system voice can't read romaji (it spells the letters), and
// articles are stored in Hepburn romaji only. This converts back to hiragana
// for SPEECH ONLY — it is never shown. Particles stay as written (wa → わ,
// wo → を) because the voice should say the sound "wa", not "ha".
// Loanwords come out in hiragana (kōhī → こうひい), which sounds the same.

enum RomajiToKana {
    private static let table: [String: String] = [
        // three letters
        "kya": "きゃ", "kyu": "きゅ", "kyo": "きょ", "sha": "しゃ", "shi": "し", "shu": "しゅ", "sho": "しょ", "she": "しぇ",
        "cha": "ちゃ", "chi": "ち", "chu": "ちゅ", "cho": "ちょ", "che": "ちぇ", "tsu": "つ", "nya": "にゃ", "nyu": "にゅ", "nyo": "にょ",
        "hya": "ひゃ", "hyu": "ひゅ", "hyo": "ひょ", "mya": "みゃ", "myu": "みゅ", "myo": "みょ", "rya": "りゃ", "ryu": "りゅ", "ryo": "りょ",
        "gya": "ぎゃ", "gyu": "ぎゅ", "gyo": "ぎょ", "bya": "びゃ", "byu": "びゅ", "byo": "びょ", "pya": "ぴゃ", "pyu": "ぴゅ", "pyo": "ぴょ",
        // two letters
        "ka": "か", "ki": "き", "ku": "く", "ke": "け", "ko": "こ", "sa": "さ", "su": "す", "se": "せ", "so": "そ",
        "ta": "た", "te": "て", "to": "と", "ti": "てぃ", "tu": "とぅ", "na": "な", "ni": "に", "nu": "ぬ", "ne": "ね", "no": "の",
        "ha": "は", "hi": "ひ", "fu": "ふ", "he": "へ", "ho": "ほ", "fa": "ふぁ", "fi": "ふぃ", "fe": "ふぇ", "fo": "ふぉ",
        "ma": "ま", "mi": "み", "mu": "む", "me": "め", "mo": "も", "ya": "や", "yu": "ゆ", "yo": "よ", "ye": "いぇ",
        "ra": "ら", "ri": "り", "ru": "る", "re": "れ", "ro": "ろ", "wa": "わ", "wo": "を", "wi": "うぃ", "we": "うぇ",
        "ga": "が", "gi": "ぎ", "gu": "ぐ", "ge": "げ", "go": "ご", "za": "ざ", "ji": "じ", "zu": "ず", "ze": "ぜ", "zo": "ぞ",
        "ja": "じゃ", "ju": "じゅ", "jo": "じょ", "je": "じぇ", "da": "だ", "de": "で", "do": "ど", "di": "でぃ", "du": "どぅ",
        "ba": "ば", "bi": "び", "bu": "ぶ", "be": "べ", "bo": "ぼ", "pa": "ぱ", "pi": "ぴ", "pu": "ぷ", "pe": "ぺ", "po": "ぽ",
        "va": "ゔぁ", "vi": "ゔぃ", "vu": "ゔ", "ve": "ゔぇ", "vo": "ゔぉ",
        // vowels
        "a": "あ", "i": "い", "u": "う", "e": "え", "o": "お",
    ]
    private static let macrons: [Character: String] = ["ā": "aa", "ī": "ii", "ū": "uu", "ē": "ee", "ō": "ou"]
    private static let vowels: Set<Character> = ["a", "i", "u", "e", "o"]

    static func convert(_ romaji: String) -> String {
        var text = ""
        // Never read brackets: "pāsento(pāsento)" would be read twice, and the
        // Japanese voice says the bracket's name ("kakko")
        let noBrackets = stripMarkers(romaji)
            .replacingOccurrences(of: #"\([^)]*\)"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"[()\[\]「」（）]"#, with: " ", options: .regularExpression)
        for ch in noBrackets.lowercased() {
            if let m = macrons[ch] { text += m } else { text.append(ch) }
        }
        let chars = Array(text)
        var out = ""
        var i = 0
        while i < chars.count {
            let c = chars[i]
            // ん: n not followed by a vowel or y ("shinbun", "hon."), or n'
            if c == "n" {
                let next = i + 1 < chars.count ? chars[i + 1] : " "
                if next == "'" { out += "ん"; i += 2; continue }
                if !vowels.contains(next) && next != "y" { out += "ん"; i += 1; continue }
            }
            // っ: doubled consonant ("kitte", "matcha")
            if i + 1 < chars.count, c.isLetter, !vowels.contains(c), c != "n",
               chars[i + 1] == c || (c == "t" && chars[i + 1] == "c") {
                out += "っ"; i += 1; continue
            }
            var matched = false
            for len in stride(from: 3, through: 1, by: -1) where i + len <= chars.count {
                if let kana = table[String(chars[i..<i + len])] {
                    out += kana; i += len; matched = true; break
                }
            }
            if matched { continue }
            switch c {
            case ".": out += "。"
            case ",": out += "、"
            case "?": out += "？"
            case "!": out += "！"
            case "-": out += " "
            default: out.append(c)
            }
            i += 1
        }
        return out
    }

    /// Article body → sentences (romaji for display, kana for the voice)
    static func sentences(of body: String) -> [(romaji: String, kana: String)] {
        let clean = stripMarkers(body)
        var result: [(String, String)] = []
        var current = ""
        for ch in clean {
            current.append(ch)
            if ".!?".contains(ch) {
                let s = current.trimmingCharacters(in: .whitespacesAndNewlines)
                if !s.isEmpty { result.append((s, convert(s))) }
                current = ""
            }
        }
        let rest = current.trimmingCharacters(in: .whitespacesAndNewlines)
        if !rest.isEmpty { result.append((rest, convert(rest))) }
        return result
    }
}
