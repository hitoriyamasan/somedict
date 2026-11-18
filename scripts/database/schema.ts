
export const schema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jmdict_id TEXT NOT NULL UNIQUE,
    primary_expression TEXT NOT NULL,
    primary_reading TEXT,
    is_common INTEGER DEFAULT 0,
    jlpt_level INTEGER,
    raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS word_forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    text TEXT NOT NULL,
    form_type TEXT NOT NULL,
    is_common INTEGER DEFAULT 0,
    tags_json TEXT,
    applies_to_json TEXT,
    FOREIGN KEY(word_id) REFERENCES words(id)
);

CREATE INDEX IF NOT EXISTS idx_forms_text
ON word_forms(text);

CREATE INDEX IF NOT EXISTS idx_forms_word
ON word_forms(word_id);

CREATE TABLE IF NOT EXISTS senses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    sense_order INTEGER NOT NULL,
    part_of_speech_json TEXT,
    raw_json TEXT NOT NULL,
    FOREIGN KEY(word_id) REFERENCES words(id)
);

CREATE TABLE IF NOT EXISTS meanings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sense_id INTEGER NOT NULL,
    language TEXT,
    gender TEXT,
    type TEXT,
    meaning TEXT NOT NULL,
    FOREIGN KEY(sense_id) REFERENCES senses(id)
);

CREATE INDEX IF NOT EXISTS idx_meanings_sense
ON meanings(sense_id);

CREATE TABLE IF NOT EXISTS sense_attributes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sense_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    value TEXT NOT NULL,
    FOREIGN KEY(sense_id) REFERENCES senses(id)
);

CREATE INDEX IF NOT EXISTS idx_sense_attributes
ON sense_attributes(category, value);

CREATE TABLE IF NOT EXISTS kanji (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    literal TEXT NOT NULL UNIQUE,
    grade INTEGER,
    stroke_count INTEGER,
    frequency INTEGER,
    jlpt_level INTEGER,
    raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kanji_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kanji_id INTEGER NOT NULL,
    reading_type TEXT,
    reading TEXT,
    FOREIGN KEY(kanji_id) REFERENCES kanji(id)
);

CREATE TABLE IF NOT EXISTS kanji_meanings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kanji_id INTEGER NOT NULL,
    language TEXT,
    meaning TEXT,
    FOREIGN KEY(kanji_id) REFERENCES kanji(id)
);

CREATE TABLE IF NOT EXISTS word_kanji (
    word_id INTEGER NOT NULL,
    kanji_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY(word_id, kanji_id, position),
    FOREIGN KEY(word_id) REFERENCES words(id),
    FOREIGN KEY(kanji_id) REFERENCES kanji(id)
);

CREATE TABLE IF NOT EXISTS jmdict_example_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    sense_order INTEGER,
    raw_json TEXT NOT NULL,
    FOREIGN KEY(word_id) REFERENCES words(id)
);

CREATE TABLE IF NOT EXISTS examples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tatoeba_id INTEGER UNIQUE,
    translation_id INTEGER,
    japanese TEXT NOT NULL,
    english TEXT,
    source TEXT,
    license TEXT
);

CREATE TABLE IF NOT EXISTS example_words (
    example_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    surface TEXT NOT NULL,
    base_form TEXT,
    position INTEGER NOT NULL,
    PRIMARY KEY(example_id, word_id, position),
    FOREIGN KEY(example_id) REFERENCES examples(id),
    FOREIGN KEY(word_id) REFERENCES words(id)
);

CREATE INDEX IF NOT EXISTS idx_example_words_word
ON example_words(word_id);

CREATE INDEX IF NOT EXISTS idx_examples_translation
ON examples(translation_id);

CREATE TABLE IF NOT EXISTS dictionary_metadata (
    key TEXT PRIMARY KEY,
    value TEXT
);
`;
