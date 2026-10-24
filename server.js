require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Sanscript = require('@indic-transliteration/sanscript');
const { YoutubeTranscript } = require('youtube-transcript');

// Ensure content directory exists
const CONTENT_DIR = path.join(__dirname, 'content');
if (!fs.existsSync(CONTENT_DIR)) {
  fs.mkdirSync(CONTENT_DIR, { recursive: true });
}

/**
 * Sanitizes a video title into a valid, safe filename across all operating systems.
 */
function sanitizeFilename(title) {
  if (!title) return 'transcript';
  let safe = title
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '') // remove illegal chars
    .replace(/[\s\t\n]+/g, ' ')            // collapse whitespaces
    .trim();
  // Strip trailing periods or spaces (disallowed on Windows)
  safe = safe.replace(/[\.\s]+$/, '');
  if (safe.length > 100) {
    safe = safe.slice(0, 100).trim();
  }
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(safe)) {
    safe = `${safe}_file`;
  }
  return safe || 'transcript';
}

/**
 * Extracts and compares transcript content from an existing file with new transcript.
 */
function isFileContentIdentical(filePath, normalizedNewText, newHash) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const fileContent = fs.readFileSync(filePath, 'utf8');

    // 1. Fast check: match Content-Hash header
    const hashMatch = fileContent.match(/^Content-Hash:\s*([a-f0-9]{64})/im);
    if (hashMatch && hashMatch[1] === newHash) {
      return true;
    }

    // 2. Secondary check: compare continuous text section
    const marker = 'FULL CONTINUOUS TEXT';
    const idx = fileContent.indexOf(marker);
    if (idx !== -1) {
      const textAfterMarker = fileContent
        .slice(idx + marker.length)
        .replace(/^[=\-\s\n\r]+/, '')
        .trim()
        .replace(/\s+/g, ' ');
      if (textAfterMarker === normalizedNewText) {
        return true;
      }
    }

    // 3. Direct check: verify if file contains the normalized text
    return fileContent.includes(normalizedNewText);
  } catch (err) {
    console.warn(`Error reading ${filePath} for content comparison:`, err.message);
    return false;
  }
}

// ============================================================================
// Hinglish & Devanagari to English Script Converter
// Solves YouTube India's issue where English audio is forced into Hindi Devanagari
// ============================================================================
const DEV_EN_MAP = {
  'यू': 'you', 'नो': 'know', 'आई': 'I', 'वास': 'was', 'वाज़': 'was', 'वाचिंग': 'watching', 'वाच': 'watch',
  'दिस': 'this', 'वन': 'one', 'क्लिप': 'clip', 'अह': 'uh', 'व्हेयर': 'where', 'कोच': 'coach', 'इज़': 'is',
  'इज़': 'is', 'इज': 'is', 'टॉकिंग': 'talking', 'अबाउट': 'about', 'कोबी': 'Kobe', 'ब्रांड': 'Bryant',
  'ब्रैंड': 'Bryant', 'ब्रांड्स': 'Bryant\'s', 'ब्रैंड्स': 'Bryant\'s', 'सो': 'so', 'डे': 'day', 'डेज़': 'days',
  'गर्लफ्रेंड': 'girlfriend', 'एट': 'at', 'द': 'the', 'कोर्ट': 'court', 'ओके': 'okay', 'आस्क': 'asked',
  'व्हाट': 'what', 'डस': 'does', 'इट': 'it', 'लाइक': 'like', 'टू': 'to', 'टु': 'to', 'बी': 'be',
  'अ': 'a', 'राइट': 'right', 'शी': 'she', 'इट्स': 'it\'s', 'एवरी': 'every', 'आफ्टर': 'after',
  'बास्केटबॉल': 'basketball', 'मैच': 'match', 'मैचेस': 'matches', 'गो': 'go', 'होम': 'home', 'एंड': 'and',
  'माइकल': 'Michael', 'जॉर्डन': 'Jordan', 'क्लिप्स': 'clips', 'दैट्स': 'that\'s', 'इमेजिन': 'imagine',
  'बिकॉज़': 'because', 'बिकॉज': 'because', 'आर': 'are', 'अपसेस्ड': 'obsessed', 'ऑब्सेस्ड': 'obsessed',
  'डोंट': 'don\'t', 'एनीथिंग': 'anything', 'एल्स': 'else', 'फ्रॉम': 'from', 'मॉर्निंग': 'morning',
  'नाईट': 'night', 'नाइट': 'night', 'ट्रेनिंग': 'training', 'फॉर': 'for', 'योरसेल्फ': 'yourself',
  'गोइंग': 'going', 'एंटरटेनमेंट': 'entertainment', 'प्ले': 'play', 'माय': 'my', 'वाइफ': 'wife',
  'सेस': 'says', 'फुटबॉल': 'football', 'फुटबॉलर': 'footballer', 'फुटबॉलर्स': 'footballers',
  'होल': 'whole', 'कम': 'come', 'कम्स': 'comes', 'बैक': 'back', 'देन': 'then', 'अगेन': 'again',
  'रोंग': 'wrong', 'विथ': 'with', 'ऑब्सेशन': 'obsession', 'मोटिवेशन': 'motivation', 'डिसिप्लिन': 'discipline',
  'कैन': 'can', 'मेक': 'make', 'मेक्स': 'makes', 'देयर': 'there', 'प्लेस': 'place', 'फाइन': 'fine',
  'वांट': 'want', 'स्टार्ट': 'start', 'डूइंग': 'doing', 'एम': 'am', 'एबल': 'able', 'समथिंग': 'something',
  'व्हिच': 'which', 'हैव': 'have', 'कांट': 'can\'t', 'विदाउट': 'without', 'अदरवाइज़': 'otherwise',
  'विल': 'will', 'डाई': 'die', 'वंस': 'ones', 'हू': 'who', 'पार्ट': 'part', 'ऑफ़': 'of', 'ऑफ': 'of',
  'नॉर्मल': 'normal', 'लाइफ': 'life', 'बट': 'but', 'सी': 'see', 'डिफिकल्ट': 'difficult',
  'इंडिया': 'India', 'बाय': 'by', 'इनहेरेंट': 'inherent', 'सोसाइटी': 'society', 'सच': 'such',
  'दैट': 'that', 'वी': 'we', 'डिसेंटिवाइज': 'disincentivize', 'नंबर': 'number', 'इन': 'in',
  'एनी': 'any', 'फील्ड': 'field', 'वैरी': 'very', 'वेरी': 'very', 'ट्रू': 'true', 'ग्रेट': 'great',
  'ग्रेटेड': 'great', 'मैथ्स': 'maths', 'शुड': 'should', 'डू': 'do', 'एज': 'as', 'वेल': 'well',
  'ओह': 'oh', 'नॉट': 'not', 'थिंग': 'thing', 'लेट': 'let', 'लेटे': 'let', 'से': 'say', 'इफ': 'if',
  'कीप': 'keep', 'ऑल': 'all', 'फैमिली': 'family', 'रिलेशनशिप': 'relationship', 'बास्केट': 'basket',
  'फेल': 'fail', 'कॉल': 'call', 'कॉल्ड': 'called', 'पर्सन': 'person', 'ब्रोक': 'broke',
  'वाइजली': 'wisely', 'रिच': 'rich', 'कॉलेज': 'college', 'हाई': 'high', 'स्कूल': 'school',
  'ड्रॉपआउट': 'dropout', 'सेलिंग': 'selling', 'बुक्स': 'books', 'लेस': 'less', 'सिक्स': 'six',
  'मंथ्स': 'months', 'हैपेंड': 'happened', 'ग्रिप': 'grip', 'कॉज': '\'cause', 'रेस्ट': 'rest',
  'जस्ट': 'just', 'नीड': 'need', 'टेल': 'tell', 'डाउन': 'down', 'शेड्यूल': 'schedule', 'लुक': 'look',
  'फाइव': 'five', 'ईयर्स': 'years', 'ईयर': 'year', 'टेन': 'ten', 'ट्वेंटी': 'twenty', 'मीन': 'mean',
  'डेवलपमेंट': 'development', 'गिगज़': 'gigs', 'गोरास': 'goras', 'फेल्ड': 'failed', 'कोचेस': 'coaches',
  'आउटसाइड': 'outside', 'क्लब्स': 'clubs', 'विन': 'win', 'मेडल': 'medal', 'मेडेल्स': 'medals',
  'ट्रॉफीज़': 'trophies', 'टीचिंग': 'teaching', 'किड्स': 'kids', 'लूज़': 'lose', 'लूज': 'lose',
  'अकैडमीज़': 'academies', 'अकैडमी': 'academy', 'बिग': 'big', 'टाइम': 'time', 'विनिंग': 'winning',
  'लूजिंग': 'losing', 'कोचिंग': 'coaching', 'लूजर्स': 'losers', 'लूजर': 'loser', 'टेलिंग': 'telling',
  'नेवर': 'never', 'हैबिट': 'habit', 'सन': 'son', 'डैड': 'dad', 'मैन': 'man', 'हाउ': 'how',
  'पार्टिसिपेशन': 'participation', 'शोइंग': 'showing', 'पीपल': 'people', 'अंडरस्टैंड': 'understand',
  'ओनली': 'only', 'स्टुपिड': 'stupid', 'ब्रिंग': 'bring', 'अप': 'up', 'टेक': 'take', 'ऑन': 'on',
  'वर्ल्ड': 'world', 'फन': 'fun', 'टिल': 'till', 'एक्चुअली': 'actually', 'बेसिकली': 'basically',
  'ट्राइंग': 'trying', 'स्पोर्ट्स': 'sports', 'स्पोर्ट': 'sport', 'अवेलेबल': 'available', 'लव': 'love',
  'मोस्ट': 'most', 'थिंक': 'think', 'बेस्ट': 'best', 'सेवेन': 'seven', 'टीटी': 'TT', 'बैडमिंटन': 'badminton',
  'वॉलीबॉल': 'volleyball', 'लर्न': 'learn', 'मोर': 'more', 'ओन': 'own', 'डिफरेंट': 'different',
  'एरिया': 'area', 'ब्रेन': 'brain', 'ओपन्स': 'opens', 'कंफ़र्ट': 'comfort', 'कंफर्ट': 'comfort',
  'ज़ोन': 'zone', 'जोन': 'zone', 'बिलीव': 'believe', 'ग्रो': 'grow', 'ग्रोथ': 'growth', 'कैंपस': 'camps',
  'कैम्पस': 'camps', 'फीलिंग': 'feeling', 'कम्फर्टेबल': 'comfortable', 'अनकम्फरफ़ेबल': 'uncomfortable',
  'फर्स्ट': 'first', 'जॉब': 'job', 'प्रोपर्ली': 'properly', 'बेटर': 'better', 'लक्ज़री': 'luxury',
  'पुश': 'push', 'पुशिंग': 'pushing', 'लिमिट': 'limit', 'लिमिट्स': 'limits', 'स्टॉप': 'stop',
  'अब्यूसिंग': 'abusing', 'गिवेन': 'given', 'पिकिंग': 'picking', 'लकिएस्ट': 'luckiest', 'गाए': 'guy',
  'फार': 'far', 'जस्टिस': 'justice', 'पोटेंशियल': 'potential', 'टैलेंट': 'talent', 'वेस्टेड': 'wasted',
  'पॉलिटिशियन': 'politician', 'वोट': 'vote', 'डिप्लोमेटिक': 'diplomatic', 'फेस': 'face', 'सक': 'suck',
  'ओपन': 'open', 'हॉरेबल': 'horrible', 'स्टेट': 'state', 'एक्सेल': 'excel', 'लेटर': 'later',
  'सिमिलर': 'similar', 'रूल': 'rule', 'नेवी': 'Navy', 'सील': 'SEAL', 'क्विट': 'quit',
  'मोमेंट': 'moment', 'स्टिल': 'still', 'बियन्ड': 'beyond', 'बाउंडिंग': 'bounding', 'सर': 'sir',
  'हिल': 'hill', 'थायरा': 'Thera', 'बैंड्स': 'bands', 'एक्टिवली': 'actively', 'पुल': 'pull',
  'एंकल': 'ankle', 'वेट्स': 'weights', 'वेट': 'weight', 'टॉप': 'top', 'केस': 'kilos',
  'प्लस': 'plus', 'रनिंग': 'running', 'लॉन्ग': 'long', 'वॉमिट': 'vomit', 'वार्म': 'warm',
  'वाइप': 'wipe', 'चांस': 'chance', 'फेंट': 'faint', 'पुट': 'put', 'वॉटर': 'water',
  'किडिंग': 'kidding', 'हार्ड': 'hard', 'ड्रीम': 'dream', 'कंट्री': 'country', 'डैम्ड': 'damned',
  'गोन्ना': 'gonna', 'लेज़ी': 'lazy', 'एस': 'ass', 'अचीव': 'achieve', 'फ्री': 'free',
  'स्कॉलरशिप': 'scholarship', 'डिवोटेड': 'devoted', 'अर्निंग': 'earning', 'स्पेंडिंग': 'spending',
  'लैक्खस': 'lakhs', 'करोड़': 'crore', 'रिजल्ट्स': 'results', 'ओरिएंटेड': 'oriented',
  'साइंटिफिक': 'scientific', 'वे': 'way', 'लैक्टिक': 'lactic', 'एसिड': 'acid', 'ब्लड': 'blood',
  'वर्क': 'work', 'एक्सप्लेन': 'explain', 'प्रोफाइल': 'profile', 'एक्जेक्टली': 'exactly',
  'एक्साक्ट्ली': 'exactly', 'प्रोटंस': 'proteins', 'प्रोटीन': 'protein', 'कार्बोहाइड्रेट्स': 'carbohydrates',
  'कार्ब्स': 'carbs', 'अकॉर्डिंग': 'according', 'बॉडी': 'body', 'विटामिन': 'vitamin',
  'लोडिंग': 'loading', 'डन': 'done', 'बिफोर': 'before', 'फ़ूड': 'food', 'नूडल्स': 'noodles',
  'राइस': 'rice', 'बनानाज़': 'bananas', 'इनफ': 'enough', 'प्राइम्ड': 'primed', 'फुल': 'full',
  'एनर्जी': 'energy', 'फैट': 'fat', 'परसेंटेज': 'percentage', 'अमाउंट': 'amount', 'पर': 'per',
  'ग्राम': 'gram', 'लॉस': 'loss', 'गेन': 'gain', 'टेस्ट': 'test', 'मशीन': 'machine',
  'व्हाइल': 'while', 'हाइड्रेशन': 'hydration', 'ब्रेक्स': 'breaks', 'हाफ': 'half',
  'डायबिटीज़': 'diabetes', 'एक्सेप्ट': 'except', 'ब्रेक': 'break', 'इम्मीडिएटली': 'immediately',
  'इमीडीएटली': 'immediately', 'टायर्ड': 'tired', 'मैटर': 'matter', 'आरपीई': 'RPE',
  'रेट': 'rate', 'पर्सिव्ड': 'perceived', 'एक्सर्शन': 'exertion', 'एथलीट': 'athlete',
  'फ्लश': 'flush', 'ग्लूकोज': 'glucose', 'मॉनिटरिंग': 'monitoring', 'पैच': 'patch',
  'लेवल': 'level', 'स्पाइक': 'spike', 'इलेक्ट्रोलाइट': 'electrolyte', 'क्रैश': 'crash',
  'बेस्ड': 'based', 'मेंटेंड': 'maintained', 'हीलियर्स': 'helios', 'लेजर': 'laser',
  'मेजर्स': 'measures', 'रिएक्शन': 'reaction', 'डिसिशन': 'decision', 'मेकिंग': 'making',
  'एडवांटेज': 'advantage', 'आर्म्ड': 'armed', 'फोर्सेज': 'forces', 'स्पेशल': 'special',
  'मैनुअल': 'manual', 'बॉक्स': 'box', 'ब्रीथिंग': 'breathing', 'पेन': 'pain', 'माइंड': 'mind',
  'ओवर': 'over', 'डेमो': 'demo', 'किलर': 'killer', 'सिग्नल': 'signal', 'सब्रेस': 'suppressed',
  'वेयर': 'wear', 'लॉजिकली': 'logically', 'स्पीकिंग': 'speaking', 'केमिकल': 'chemical',
  'कंट्रोल': 'control', 'इनसाइड': 'inside', 'न्यूरॉन्स': 'neurons', 'फीलिंग': 'feeling',
  'अग्रीड': 'agreed', 'बुद्धिस्ट': 'Buddhist', 'मंक्स': 'monks', 'फोटो': 'photo',
  'ऋषि': 'rishi', 'मुनिस': 'munis', 'मीटर्स': 'meters', 'माइनस': 'minus', 'फ्रोजन': 'frozen',
  'बियर्ड्स': 'beards', 'कोल्ड': 'cold', 'गोल्ड': 'cold', 'ट्रेंड': 'trained', 'शट': 'shut',
  'मेजर': 'Major', 'एसएफ': 'SF', 'टेक्निक': 'technique', 'यूज': 'use', 'सक्सेसफुल': 'successful',
  'प्रोड्यूस': 'produced', 'ओवरवर्किंग': 'overworking', 'मसल': 'muscle', 'मसल्स': 'muscles',
  'माइट': 'might', 'स्प्रेन': 'sprain', 'स्ट्रेन': 'strain', 'रप्चर': 'rupture', 'व्हाटएवर': 'whatever',
  'जिम्स': 'gyms', 'सपोज': 'suppose', 'बाईसेप': 'bicep', 'रैप्स': 'reps', 'रैप': 'rep',
  'सेट': 'set', 'सेट्स': 'sets', 'करेक्ट': 'correct', 'स्टेप': 'rep', 'ड्रॉप्स': 'drops',
  'सेकंड्स': 'seconds', 'ओवरवेट': 'overweight', 'ओवरस्लीप': 'oversleep', 'पावर': 'power',
  'स्क्वाट्स': 'squats', 'स्क्वाट': 'squat', 'सिंगिंग': 'sitting', 'सिटिंग': 'sitting',
  'चेयर': 'chair', 'रिड्यूस': 'reduced', 'पॉट': 'pot', 'स्क्रीनिंग': 'screaming',
  'अटेंशन': 'attention'
};

const DEV_HI_ROMAN_MAP = {
  'ये': 'yeh', 'सारा': 'saara', 'इन': 'in', 'तीनों': 'teeno', 'चीज़ों': 'cheezon', 'चीजों': 'cheezon',
  'से': 'se', 'आता': 'aata', 'है': 'hai', 'हैं': 'hain', 'मैंने': 'maine', 'करना': 'karna',
  'के': 'ke', 'ठीक': 'theek', 'हट': 'hat', 'जाती': 'jaati', 'थोड़ी': 'thodi', 'थोड़ी': 'thodi',
  'देर': 'der', 'में': 'mein', 'फिर': 'phir', 'और': 'aur', 'लेकिन': 'lekin', 'बहुत': 'bahut',
  'हमारी': 'hamaari', 'ऐसी': 'aisi', 'कल': 'kal', 'तेरे': 'tere', 'को': 'ko', 'कहीं': 'kahin',
  'निकाल': 'nikaal', 'दिया': 'diya', 'कुछ': 'kuch', 'चाहिए': 'chahiye', 'होगा': 'hoga', 'लोड': 'load',
  'पड़ेगी': 'padegi', 'यही': 'yahi', 'होंगे': 'honge', 'क्या': 'kya', 'मतलब': 'matlab',
  'मेरे': 'mere', 'नहीं': 'nahin', 'ज़रूरत': 'zaroorat', 'जरूरत': 'zaroorat', 'इनसे': 'inse',
  'इसीलिए': 'iseeliye', 'रखूं': 'rakhoon', 'कि': 'ki', 'मेरी': 'meri', 'किस': 'kis', 'दिन': 'din',
  'लग': 'lag', 'गई': 'gayi', 'तो': 'toh', 'पास': 'paas', 'आएंगे': 'aayenge', 'तब': 'tab',
  'भी': 'bhi', 'ख्याल': 'khayaal', 'रख': 'rakh', 'लूंगा': 'loonga', 'रखो': 'rakho', 'इसके': 'iske',
  'लिए': 'liye', 'टट्टू': 'tattu', 'हो': 'ho', 'गया': 'gaya', 'कहा': 'kahan', 'जाएगा': 'jaayega',
  'अच्छा': 'achha', 'अपनी': 'apni', 'वालों': 'waalon', 'बना': 'bana', 'साले': 'saale',
  'आजकल': 'aajkal', 'देते': 'dete', 'गला': 'gala', 'साफ़': 'saaf', 'करने': 'karne', 'की': 'ki',
  'आवाज़': 'aawaaz', 'नाक': 'naak', 'भाई': 'bhai', 'उठ': 'uth', 'तू': 'tu', 'यार': 'yaar',
  'जल्दी': 'jaldi', 'कर': 'kar', 'ले': 'le', 'दर्द': 'dard', 'होती': 'hoti', 'जलन': 'jalan',
  'मर': 'mar', 'लगाने': 'lagaane', 'इकट्ठे': 'ikatthe', 'अगर': 'agar', 'तुम्हारा': 'tumhaara',
  'लगेगी': 'lagegi', 'ना': 'na', 'साहब': 'sahab', 'बोलने': 'bolne', 'काफी': 'kaafi',
  'होता': 'hota', 'कैसे': 'kaise', 'करोगे': 'karoge', 'आप': 'aap', 'कहा': 'kaha',
  'कहता': 'kehta', 'होएगी': 'hoyegi', 'दोबारा': 'dobaara', 'आएगी': 'aayegi', 'हां': 'haan',
  'बैठे': 'baithe', 'रहते': 'rehte', 'नंगे': 'nange', 'कहते': 'kehte', 'इसको': 'isko',
  'सब': 'sab', 'बताते': 'bataate', 'कुछ': 'kuch', 'खराब': 'kharaab', 'दिखाया': 'dikhaaya',
  'करो': 'karo', 'मैंने': 'maine', 'बोला': 'bola', 'पूछ': 'pooch', 'रही': 'rahi'
};

function convertDevanagariToEnglishScript(text) {
  if (!text) return '';

  let cleaned = text.replace(/\[[^\]]*(?:आवाज़|ध्वनि|शोर|हंसी)[^\]]*\]/g, '');
  cleaned = cleaned.replace(/।/g, '.');

  let converted = cleaned.replace(/[\u0900-\u097F]+/g, (word) => {
    if (DEV_EN_MAP[word]) return DEV_EN_MAP[word];
    const stripped = word.replace(/[\u093C]/g, '');
    if (DEV_EN_MAP[stripped]) return DEV_EN_MAP[stripped];

    if (DEV_HI_ROMAN_MAP[word]) return DEV_HI_ROMAN_MAP[word];
    if (DEV_HI_ROMAN_MAP[stripped]) return DEV_HI_ROMAN_MAP[stripped];

    try {
      let rom = Sanscript.t(word, 'devanagari', 'itrans')
        .replace(/aa/g, 'a')
        .replace(/ii/g, 'i')
        .replace(/uu/g, 'u')
        .replace(/Sh/g, 'sh')
        .replace(/Ch/g, 'ch')
        .replace(/[MDH]/g, '')
        .toLowerCase();
      return rom;
    } catch {
      return word;
    }
  });

  converted = converted
    .replace(/(^|[.?!]\s+)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase())
    .replace(/\bi\b/g, 'I');

  return converted;
}

/**
 * Formats full continuous text:
 * - Breaks the line after every full stop (. ? ! ।)
 * - Breaks the line for every speaker transition (SPEAKER:, >>, [Speaker Name]:, etc.)
 * - Protects abbreviations (Dr., Mr., vs., etc.) and decimals ($3.50, 24.0) from false splits
 */
function formatContinuousText(rawText) {
  if (!rawText) return '';

  let text = rawText
    .replace(/(?:\r\n|\r|\n)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const SPEAKER_SPLIT_TOKEN = '___SPEAKER_BREAK___';

  // Match >> or >>> speaker transitions
  text = text.replace(/(?:\s|^)(>{2,3})\s*/g, ` ${SPEAKER_SPLIT_TOKEN}$1 `);

  // Match SPEAKER / SPEAKER 1: / SPEAKER [A-Z]:
  text = text.replace(/(?:\s|^)(SPEAKER(?:\s*\d+|\s+[A-Z])?\s*:)/gi, ` ${SPEAKER_SPLIT_TOKEN}$1`);

  // Match [Speaker Name]: or [Speaker Name]
  text = text.replace(/(?:\s|^)(\[[A-Za-z0-9_\s]{2,30}\]:?)/g, ` ${SPEAKER_SPLIT_TOKEN}$1`);

  const ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc', 'eg', 'ie',
    'us', 'uk', 'usa', 'inc', 'ltd', 'co', 'corp', 'st', 'no', 'vol', 'dept',
    'est', 'approx', 'min', 'sec', 'hr', 'jan', 'feb', 'mar', 'apr', 'jun',
    'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec'
  ]);

  const speakerBlocks = text
    .split(SPEAKER_SPLIT_TOKEN)
    .map((b) => b.trim())
    .filter(Boolean);

  const formattedBlocks = speakerBlocks.map((block) => {
    const broken = block.replace(/([.?!।]+)(["'”’)]*)(\s+|$)/g, (match, punct, quote, space, offset, fullStr) => {
      // 1. Skip ellipsis (... or ..)
      if (punct.length > 1 && punct.includes('.')) {
        return match;
      }

      // 2. Skip decimals (e.g. 24.0 or $3.50)
      const prevChars = fullStr.slice(Math.max(0, offset - 15), offset);
      const nextChars = fullStr.slice(offset + match.length, offset + match.length + 15);
      if (/\d$/.test(prevChars) && /^\d/.test(nextChars)) {
        return match;
      }

      // 3. Skip abbreviations (e.g. Dr. or U.S.)
      const wordMatch = prevChars.match(/([a-zA-Z]+)$/);
      if (wordMatch) {
        const lastWord = wordMatch[1].toLowerCase();
        if (ABBREVIATIONS.has(lastWord)) {
          return match;
        }
        if (wordMatch[1].length === 1 && !prevChars.endsWith(' I')) {
          return match;
        }
      }

      // Break line after full stop
      return `${punct}${quote}\n`;
    });

    return broken
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n');
  });

  return formattedBlocks.join('\n\n');
}

/**
 * Logs transcript to the content folder with collision and content identity checking.
 * 
 * Rules:
 * - One file per video named from the video title.
 * - If file exists:
 *   - Check if video content is the same as existing file.
 *   - If same: return existing file info (do not duplicate file).
 *   - If different: create a new file with numeric suffix (Title (1).txt, Title (2).txt, etc.)
 */
function logTranscriptToContent({ videoId, metadata, paragraphs, fullText, trackLanguage, stats }) {
  try {
    if (!fs.existsSync(CONTENT_DIR)) {
      fs.mkdirSync(CONTENT_DIR, { recursive: true });
    }

    const title = metadata?.title || `YouTube Video ${videoId}`;
    const baseName = sanitizeFilename(title);
    const normalizedNewText = fullText.trim().replace(/\s+/g, ' ');
    const newHash = crypto.createHash('sha256').update(normalizedNewText).digest('hex');

    // Prepare standardized file content
    const headerLines = [
      `Title: ${title}`,
      `Video ID: ${videoId}`,
      `Video URL: https://www.youtube.com/watch?v=${videoId}`,
      `Channel: ${metadata?.author || 'Unknown'}`,
      `Duration: ${stats?.duration || metadata?.duration || 'Unknown'}`,
      `Language: ${trackLanguage || 'Original'}`,
      `Total Words: ${stats?.totalWords || 0}`,
      `Transcribed At: ${new Date().toISOString()}`,
      `Content-Hash: ${newHash}`,
      '',
      '='.repeat(80),
      'TIMESTAMPED PARAGRAPHS',
      '='.repeat(80),
      '',
    ];

    const timestampLines = (paragraphs || []).map(
      (p) => `[${p.timestamp || '0:00'}] ${p.text}`
    );

    const formattedContinuousText = formatContinuousText(fullText);
    const fullTextSection = [
      '',
      '='.repeat(80),
      'FULL CONTINUOUS TEXT',
      '='.repeat(80),
      '',
      formattedContinuousText,
      '',
    ];

    const fileContent = [...headerLines, ...timestampLines, ...fullTextSection].join('\n');

    const baseFileName = `${baseName}.txt`;
    const baseFilePath = path.join(CONTENT_DIR, baseFileName);

    // Case 1: Base file does NOT exist yet -> Create it
    if (!fs.existsSync(baseFilePath)) {
      fs.writeFileSync(baseFilePath, fileContent, 'utf8');
      console.log(`[Content Log] Created new transcript file: content/${baseFileName}`);
      return {
        filename: baseFileName,
        relativePath: `content/${baseFileName}`,
        status: 'created',
        isSameContent: false,
        message: `Saved transcript to content/${baseFileName}`,
      };
    }

    // Case 2: Base file exists -> Check if content is identical
    if (isFileContentIdentical(baseFilePath, normalizedNewText, newHash)) {
      console.log(`[Content Log] Identical content found in content/${baseFileName}. Showing existing file.`);
      return {
        filename: baseFileName,
        relativePath: `content/${baseFileName}`,
        status: 'identical',
        isSameContent: true,
        message: `Content is identical to existing file content/${baseFileName}. Reused existing file.`,
      };
    }

    // Case 3: Base file exists but content differed -> Look for or create numbered version (1), (2), ...
    let counter = 1;
    let candidateFileName = `${baseName} (${counter}).txt`;
    let candidateFilePath = path.join(CONTENT_DIR, candidateFileName);

    while (fs.existsSync(candidateFilePath)) {
      if (isFileContentIdentical(candidateFilePath, normalizedNewText, newHash)) {
        console.log(`[Content Log] Identical content found in content/${candidateFileName}. Showing existing file.`);
        return {
          filename: candidateFileName,
          relativePath: `content/${candidateFileName}`,
          status: 'identical',
          isSameContent: true,
          message: `Content is identical to existing file content/${candidateFileName}. Reused existing file.`,
        };
      }
      counter++;
      candidateFileName = `${baseName} (${counter}).txt`;
      candidateFilePath = path.join(CONTENT_DIR, candidateFileName);
    }

    // Write new numbered version
    fs.writeFileSync(candidateFilePath, fileContent, 'utf8');
    console.log(`[Content Log] Content differed. Created new version: content/${candidateFileName}`);
    return {
      filename: candidateFileName,
      relativePath: `content/${candidateFileName}`,
      status: 'created_version',
      versionNumber: counter,
      isSameContent: false,
      message: `Content differed from original. Saved new version as content/${candidateFileName}`,
    };
  } catch (logErr) {
    console.error('[Content Log] Error logging transcript file:', logErr);
    return {
      filename: null,
      status: 'error',
      isSameContent: false,
      message: `Failed to save file: ${logErr.message}`,
    };
  }
}

// ============================================================================
// Option 2: Proxy Support for Cloud Deployments (Render / AWS / Heroku)
// Routes all outgoing fetch requests through a residential proxy to bypass
// YouTube cloud datacenter IP blocks.
// ============================================================================
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.PROXY_URL;
if (proxyUrl) {
  try {
    const { ProxyAgent, setGlobalDispatcher } = require('undici');
    const proxyAgent = new ProxyAgent(proxyUrl);
    setGlobalDispatcher(proxyAgent);
    const sanitized = proxyUrl.replace(/:[^:@]+@/, ':****@');
    console.log(`[Proxy] Global fetch dispatcher active via: ${sanitized}`);
  } catch (err) {
    console.error('[Proxy] Failed to configure proxy agent:', err.message);
  }
}

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const LANGUAGE_NAMES = {
  en: 'English',
  hi: 'Hindi',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  ar: 'Arabic',
  bn: 'Bengali',
  mr: 'Marathi',
  te: 'Telugu',
  ta: 'Tamil',
  gu: 'Gujarati',
  ur: 'Urdu',
  kn: 'Kannada',
  ml: 'Malayalam',
  pa: 'Punjabi',
};

function getLanguageName(code) {
  if (!code) return 'Original Language';
  const clean = code.toLowerCase().split('-')[0];
  return LANGUAGE_NAMES[clean] || code;
}

/**
 * Extracts 11-character YouTube video ID from various URL formats
 */
function extractVideoId(urlOrId) {
  if (!urlOrId) return null;
  const trimmed = urlOrId.trim();

  // If already an 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  // Regex for full, short, embed, and shorts URLs
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/\s]{11})/i;
  const match = trimmed.match(regex);
  return match ? match[1] : null;
}

/**
 * Fetches video metadata via YouTube oEmbed API (no API key needed)
 */
async function fetchVideoMetadata(videoId) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetch(oembedUrl);
    if (!response.ok) {
      throw new Error(`oEmbed failed with status ${response.status}`);
    }
    const data = await response.json();
    return {
      title: data.title || 'YouTube Video',
      author: data.author_name || 'YouTube Channel',
      authorUrl: data.author_url || '',
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      maxresThumbnailUrl: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      embedHtml: data.html || '',
    };
  } catch (err) {
    console.warn(`Could not fetch oEmbed for ${videoId}:`, err.message);
    return {
      title: `YouTube Video (${videoId})`,
      author: 'YouTube Channel',
      authorUrl: '',
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      maxresThumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      embedHtml: '',
    };
  }
}

/**
 * Robust Multi-Strategy YouTube Caption Extractor
 * Primary: Official Android InnerTube Gateway (bypasses data-center IP blocks on Render/AWS)
 * Fallback: Web page HTML scraper
 */
async function fetchDirectCaptionTracks(videoId, requestedLang) {
  let captionTracks = null;

  // 1. Primary Strategy: Android InnerTube Gateway
  try {
    const resp = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
      },
      body: JSON.stringify({
        context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
        videoId: videoId,
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    }
  } catch (errInnerTube) {
    console.warn(`InnerTube player failed for ${videoId}:`, errInnerTube.message);
  }

  // 2. Secondary Strategy: Web page scraping
  if (!captionTracks || captionTracks.length === 0) {
    try {
      const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const res = await fetch(watchUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      const html = await res.text();
      const playerResponseMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
      if (playerResponseMatch) {
        const playerResponse = JSON.parse(playerResponseMatch[1]);
        captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      }
    } catch (errWeb) {
      console.warn(`Web scrape failed for ${videoId}:`, errWeb.message);
    }
  }

  if (!captionTracks || captionTracks.length === 0) {
    const isCloudEnv = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.AWS_REGION);
    if (isCloudEnv && !proxyUrl) {
      throw new Error(
        'YouTube blocked caption access from Render cloud datacenter IP. ' +
        'To enable transcription on Render, configure HTTPS_PROXY in Render Environment Variables (e.g., from webshare.io), or run locally via npm run tunnel.'
      );
    }
    throw new Error('No caption tracks found for this video. The creator may have disabled subtitles, or the video is private/restricted.');
  }

  // Smart track selection priority:
  // 1. User requested language (if provided)
  // 2. English track (en, en-US, en-GB, a.en)
  // 3. Auto-generated native track (kind: 'asr')
  // 4. First available caption track
  let selectedTrack = null;
  if (requestedLang && requestedLang !== 'auto') {
    selectedTrack = captionTracks.find(
      (t) => t.languageCode === requestedLang || t.vssId?.includes(`.${requestedLang}`)
    );
  }
  if (!selectedTrack) {
    selectedTrack = captionTracks.find((t) => t.languageCode?.startsWith('en'));
  }
  if (!selectedTrack) {
    selectedTrack = captionTracks.find((t) => t.kind === 'asr');
  }
  if (!selectedTrack) {
    selectedTrack = captionTracks[0];
  }

  // Fetch the timedtext XML using a proper browser user-agent
  const timedTextUrl = selectedTrack.baseUrl;
  const timedTextRes = await fetch(timedTextUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)',
    },
  });

  if (!timedTextRes.ok) {
    throw new Error(`Timedtext HTTP ${timedTextRes.status}`);
  }

  const xml = await timedTextRes.text();
  const items = [];

  // Parse modern format 3: <p t="ms" d="ms"><s>...</s></p>
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let match;
  while ((match = pRegex.exec(xml)) !== null) {
    const startMs = parseInt(match[1], 10);
    const durMs = parseInt(match[2], 10);
    let rawText = match[3]
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/\n/g, ' ')
      .trim();

    if (rawText) {
      items.push({
        text: rawText,
        offset: startMs,
        duration: durMs,
        lang: selectedTrack.languageCode || 'auto',
      });
    }
  }

  // Fallback to classic format: <text start="s" dur="s">...</text>
  if (items.length === 0) {
    const textRegex = /<text\s+start="([0-9.]+)"\s+dur="([0-9.]+)"[^>]*>([\s\S]*?)<\/text>/g;
    let tMatch;
    while ((tMatch = textRegex.exec(xml)) !== null) {
      const offsetSec = parseFloat(tMatch[1]);
      const durationSec = parseFloat(tMatch[2]);
      let rawText = tMatch[3]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/\n/g, ' ')
        .trim();

      if (rawText) {
        items.push({
          text: rawText,
          offset: Math.round(offsetSec * 1000),
          duration: Math.round(durationSec * 1000),
          lang: selectedTrack.languageCode || 'auto',
        });
      }
    }
  }

  if (items.length === 0) {
    throw new Error('Parsed 0 timedtext segments from caption tracks.');
  }

  const trackName = selectedTrack.name?.simpleText || selectedTrack.name?.runs?.[0]?.text || selectedTrack.languageCode;

  return {
    items,
    language: trackName || selectedTrack.languageCode || 'Original',
    languageCode: selectedTrack.languageCode || 'auto',
    availableTracks: captionTracks.map((t) => ({
      name: t.name?.simpleText || t.name?.runs?.[0]?.text || t.languageCode,
      code: t.languageCode,
      isAuto: Boolean(t.kind === 'asr'),
    })),
  };
}

/**
 * Format milliseconds into HH:MM:SS or MM:SS
 */
function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Groups rapid sentence fragments into readable coherent paragraphs with single timestamps
 */
function groupIntoParagraphs(items, pauseThresholdMs = 2000, targetWordsPerPara = 60) {
  const paragraphs = [];
  let currentGroup = [];
  let startTime = 0;
  let wordCount = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const prev = items[i - 1];

    if (currentGroup.length === 0) {
      startTime = item.offset;
    }

    const words = item.text.split(/\s+/).filter(Boolean);
    wordCount += words.length;

    let pause = 0;
    if (prev) {
      pause = item.offset - (prev.offset + prev.duration);
    }

    currentGroup.push(item.text);

    const isLast = i === items.length - 1;
    const endsWithPunctuation = /[.?!]$/.test(item.text.trim());

    // Break paragraph if:
    // 1. Natural punctuation after at least 25 words
    // 2. Significant pause (>2s) after at least 25 words
    // 3. Or word count reached target (e.g. 60 words) regardless of punctuation
    const shouldBreak =
      isLast ||
      (wordCount >= 25 && endsWithPunctuation) ||
      (wordCount >= 25 && pause >= pauseThresholdMs) ||
      wordCount >= targetWordsPerPara;

    if (shouldBreak) {
      paragraphs.push({
        timestamp: formatTime(startTime),
        startMs: startTime,
        text: currentGroup.join(' ').replace(/\s+/g, ' ').trim(),
      });
      currentGroup = [];
      wordCount = 0;
    }
  }

  if (currentGroup.length > 0) {
    paragraphs.push({
      timestamp: formatTime(startTime),
      startMs: startTime,
      text: currentGroup.join(' ').replace(/\s+/g, ' ').trim(),
    });
  }

  return paragraphs;
}

/**
 * API: /api/transcribe
 * Takes { url: string, lang?: string }
 */
app.post('/api/transcribe', async (req, res) => {
  try {
    const { url, lang } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid YouTube video URL or ID.',
      });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid YouTube URL or Video ID. Please check the link and try again.',
      });
    }

    // 1. Fetch metadata in parallel
    const metadataPromise = fetchVideoMetadata(videoId);

    // 2. Fetch transcript with multi-strategy fallback
    let transcriptItems = null;
    let trackLanguage = 'Original';
    let availableTracks = [];

    // Strategy 1: Direct Android InnerTube Gateway (Highest reliability on cloud hosts like Render)
    try {
      const directResult = await fetchDirectCaptionTracks(videoId, lang);
      transcriptItems = directResult.items;
      trackLanguage = getLanguageName(directResult.languageCode) || directResult.language;
      availableTracks = directResult.availableTracks;
    } catch (errDirect) {
      console.warn(`Strategy 1 (Direct Android Gateway) failed for ${videoId}:`, errDirect.message);

      // Strategy 2: youtube-transcript package fallback
      try {
        if (lang && lang !== 'auto') {
          transcriptItems = await YoutubeTranscript.fetchTranscript(videoId, { lang });
          trackLanguage = getLanguageName(lang);
        } else {
          transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);
          const rawLang = transcriptItems[0]?.lang || 'Original';
          trackLanguage = getLanguageName(rawLang);
        }
      } catch (errLib) {
        console.warn(`Strategy 2 (youtube-transcript) failed for ${videoId}:`, errLib.message);
        throw new Error(
          errDirect.message || 'Could not retrieve transcript for this video. The creator may have disabled closed captions, or the video might be private/age-restricted.'
        );
      }
    }

    const metadata = await metadataPromise;

    if (!transcriptItems || transcriptItems.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No transcript segments were found for this video.',
      });
    }

    // Check if the transcript contains Devanagari characters (Hindi / Hinglish phonetics)
    const rawJoined = transcriptItems.map((i) => i.text).join(' ');
    const hasDevanagari = /[\u0900-\u097F]/.test(rawJoined);

    // If requested language is English or Auto, convert Devanagari phonetics into English Latin script
    // to preserve English as spoken in the video!
    const shouldConvertToEnglish = hasDevanagari && (lang === 'en' || lang === 'auto' || !lang);

    let devanagariParagraphs = null;
    let devanagariFullText = null;

    if (hasDevanagari) {
      const devItems = transcriptItems.map((item) => ({
        ...item,
        text: item.text.replace(/\n/g, ' ').trim(),
      }));
      devanagariParagraphs = groupIntoParagraphs(devItems);
      devanagariFullText = formatContinuousText(devItems.map((i) => i.text).join(' '));

      if (shouldConvertToEnglish) {
        transcriptItems = transcriptItems.map((item) => ({
          ...item,
          text: convertDevanagariToEnglishScript(item.text).replace(/\n/g, ' ').trim(),
        }));
        trackLanguage = 'English (Spoken in Video)';
      }
    }

    // Process items
    const formattedSegments = transcriptItems.map((item, idx) => ({
      id: idx + 1,
      startMs: item.offset,
      durationMs: item.duration,
      timestamp: formatTime(item.offset),
      text: item.text.replace(/\n/g, ' ').trim(),
    }));

    // Group into readable conversational paragraphs
    const paragraphs = groupIntoParagraphs(transcriptItems);

    // Continuous text with line break after every full stop and speaker change
    const rawFullText = transcriptItems
      .map((i) => i.text.replace(/\n/g, ' ').trim())
      .join(' ')
      .replace(/\s+/g, ' ');
    const fullText = formatContinuousText(rawFullText);

    // Calculate statistics
    const totalWords = rawFullText.split(/\s+/).filter(Boolean).length;
    const totalCharacters = rawFullText.length;
    const lastItem = transcriptItems[transcriptItems.length - 1];
    const totalDurationMs = lastItem ? lastItem.offset + lastItem.duration : 0;
    const formattedDuration = formatTime(totalDurationMs);
    const estimatedReadingTimeMinutes = Math.max(1, Math.ceil(totalWords / 200));

    // 3. Log transcript to content folder (one file per video, check content identity)
    const loggedFile = logTranscriptToContent({
      videoId,
      metadata,
      paragraphs,
      fullText,
      trackLanguage,
      stats: {
        duration: formattedDuration,
        totalWords,
      },
    });

    return res.json({
      success: true,
      videoId,
      metadata: {
        ...metadata,
        duration: formattedDuration,
        durationMs: totalDurationMs,
      },
      stats: {
        totalWords,
        totalCharacters,
        totalSegments: formattedSegments.length,
        totalParagraphs: paragraphs.length,
        readingTimeMinutes: estimatedReadingTimeMinutes,
        duration: formattedDuration,
        language: trackLanguage,
      },
      hasDevanagari,
      devanagariParagraphs,
      devanagariFullText,
      loggedFile,
      availableTracks,
      paragraphs,
      segments: formattedSegments,
      fullText,
    });
  } catch (error) {
    console.error('Transcription error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'An unexpected error occurred while transcribing the video.',
    });
  }
});

/**
 * Lists all logged transcript files from the content folder
 */
app.get('/api/content', (req, res) => {
  try {
    if (!fs.existsSync(CONTENT_DIR)) {
      return res.json({ success: true, count: 0, files: [] });
    }
    const entries = fs.readdirSync(CONTENT_DIR, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.txt'))
      .map((e) => {
        const fullPath = path.join(CONTENT_DIR, e.name);
        const stats = fs.statSync(fullPath);
        return {
          filename: e.name,
          relativePath: `content/${e.name}`,
          sizeBytes: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));

    return res.json({ success: true, count: files.length, files });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Returns the text content of a specific logged transcript file
 */
app.get('/api/content/file', (req, res) => {
  try {
    const filename = req.query.name;
    if (!filename) {
      return res.status(400).json({ success: false, error: 'Filename parameter required' });
    }
    // Security: sanitize path traversal
    const safeName = path.basename(filename);
    const targetPath = path.join(CONTENT_DIR, safeName);
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    const content = fs.readFileSync(targetPath, 'utf8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(content);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Health check
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'YouTranscribe API', time: new Date().toISOString() });
});

// Fallback to index.html for SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(` TranscribeTube Server Running`);
  console.log(` Local:   http://localhost:${PORT}`);
  console.log(` API:     http://localhost:${PORT}/api/transcribe`);
  console.log(`===============================================`);
});
