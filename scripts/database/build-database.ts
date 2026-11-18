
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import kuromoji from 'kuromoji';
import readline from 'node:readline';

import { schema } from './schema';

const ROOT = process.cwd();

const FILES = {
    jmdictAll: path.join(ROOT, 'data/jmdict/jmdict_all.json'),
    jmdictCommon: path.join(ROOT, 'data/jmdict/jmdict_common.json'),
    jmdictExamples: path.join(ROOT, 'data/jmdict/jmdict_examples.json'),
    kanjidic: path.join(ROOT, 'data/kanjidic2/kanjidic2.json'),
    tatoeba: path.join(ROOT, 'data/tatoeba/tatoeba.jsonl'),
    database: path.join(ROOT, 'data/database/dictionary.db')
};

type JsonObject = Record<string, any>;

const ensureDirectory = (file: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
};

function readJson(file: string): JsonObject {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function json(value: unknown): string {
    return JSON.stringify(value ?? null);
}

function getWords(data: JsonObject): JsonObject[] {
    if (!Array.isArray(data.words)) {
        throw new Error('Formato JSON inválido: propriedade words não encontrada.');
    }

    return data.words;
}

function getKanjis(data: JsonObject): JsonObject[] {
    if (!Array.isArray(data.characters)) {
        throw new Error('Formato KANJIDIC2 inválido: characters não encontrado.');
    }

    return data.characters;
}

function log(message: string) {
    console.log(`[Dictionary] ${message}`);
}


function importJMDict(
    db: Database.Database,
    words: JsonObject[],
    commonIds: Set<string>
) {
    const insertWord = db.prepare(`
        INSERT INTO words (
            jmdict_id,
            primary_expression,
            primary_reading,
            is_common,
            raw_json
        ) VALUES (?, ?, ?, ?, ?)
    `);

    const insertForm = db.prepare(`
        INSERT INTO word_forms (
            word_id,
            text,
            form_type,
            is_common,
            tags_json,
            applies_to_json
        ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertSense = db.prepare(`
        INSERT INTO senses (
            word_id,
            sense_order,
            part_of_speech_json,
            raw_json
        ) VALUES (?, ?, ?, ?)
    `);

    const insertMeaning = db.prepare(`
        INSERT INTO meanings (
            sense_id,
            language,
            gender,
            type,
            meaning
        ) VALUES (?, ?, ?, ?, ?)
    `);

    const insertAttribute = db.prepare(`
        INSERT INTO sense_attributes (
            sense_id,
            category,
            value
        ) VALUES (?, ?, ?)
    `);

    const transaction = db.transaction(() => {
        for (const word of words) {
            const kanji = word.kanji ?? [];
            const kana = word.kana ?? [];
            const senses = word.sense ?? [];

            const id = String(word.id);

            const primaryExpression =
                kanji[0]?.text ??
                kana[0]?.text;

            const primaryReading =
                kana[0]?.text ?? null;

            if (!primaryExpression) continue;

            const isCommon = commonIds.has(id) ||
                kanji.some((item: JsonObject) => item.common) ||
                kana.some((item: JsonObject) => item.common);

            const result = insertWord.run(
                id,
                primaryExpression,
                primaryReading,
                isCommon ? 1 : 0,
                json(word)
            );

            const wordId = Number(result.lastInsertRowid);

            for (const form of kanji) {
                insertForm.run(
                    wordId,
                    form.text,
                    'kanji',
                    form.common ? 1 : 0,
                    json(form.tags),
                    json(form.appliesToKana)
                );
            }

            for (const form of kana) {
                insertForm.run(
                    wordId,
                    form.text,
                    'kana',
                    form.common ? 1 : 0,
                    json(form.tags),
                    json(form.appliesToKanji)
                );
            }

            senses.forEach((sense: JsonObject, index: number) => {
                const senseResult = insertSense.run(
                    wordId,
                    index,
                    json(sense.partOfSpeech),
                    json(sense)
                );

                const senseId = Number(senseResult.lastInsertRowid);

                for (const gloss of sense.gloss ?? []) {
                    insertMeaning.run(
                        senseId,
                        gloss.lang ?? 'eng',
                        gloss.gender,
                        gloss.type,
                        gloss.text
                    );
                }

                const attributes = [
                    'partOfSpeech',
                    'field',
                    'dialect',
                    'misc',
                    'info'
                ];

                for (const category of attributes) {
                    for (const value of sense[category] ?? []) {
                        insertAttribute.run(
                            senseId,
                            category,
                            value
                        );
                    }
                }
            });
        }
    });

    transaction();

    log(`JMdict importado: ${words.length} entradas`);
}

function importKANJIDIC(
    db: Database.Database,
    characters: JsonObject[]
) {
    const insertKanji = db.prepare(`
        INSERT INTO kanji (
            literal,
            grade,
            stroke_count,
            frequency,
            jlpt_level,
            raw_json
        ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertReading = db.prepare(`
        INSERT INTO kanji_readings (
            kanji_id,
            reading_type,
            reading
        ) VALUES (?, ?, ?)
    `);

    const insertMeaning = db.prepare(`
        INSERT INTO kanji_meanings (
            kanji_id,
            language,
            meaning
        ) VALUES (?, ?, ?)
    `);

    const transaction = db.transaction(() => {
        for (const character of characters) {
            const misc = character.misc ?? {};

            const result = insertKanji.run(
                character.literal,
                misc.grade ?? null,
                misc.strokeCounts?.[0] ?? null,
                misc.frequency ?? null,
                misc.jlptLevel ?? null,
                json(character)
            );

            const kanjiId = Number(result.lastInsertRowid);

            const groups =
                character.readingMeaning?.groups ?? [];

            for (const group of groups) {
                for (const reading of group.readings ?? []) {
                    insertReading.run(
                        kanjiId,
                        reading.type,
                        reading.value
                    );
                }

                for (const meaning of group.meanings ?? []) {
                    insertMeaning.run(
                        kanjiId,
                        meaning.lang ?? 'en',
                        meaning.value
                    );
                }
            }

            // Nanori são leituras especiais de nomes.
            for (const reading of character.readingMeaning?.nanori ?? []) {
                insertReading.run(
                    kanjiId,
                    'nanori',
                    reading
                );
            }
        }
    });

    transaction();

    log(`KANJIDIC2 importado: ${characters.length} kanjis`);
}

function importJMDictExamples(
    db: Database.Database,
    words: JsonObject[]
) {
    const insert = db.prepare(`
        INSERT INTO jmdict_example_data (
            word_id,
            sense_order,
            raw_json
        )
        SELECT id, ?, ?
        FROM words
        WHERE jmdict_id = ?
    `);

    const transaction = db.transaction(() => {
        let imported = 0;

        for (const word of words) {
            const id = String(word.id);

            const senses = word.sense ?? [];

            // Preserva o registro completo do arquivo examples,
            // incluindo estruturas que ainda não normalizamos.
            for (let index = 0; index < senses.length; index++) {
                const result = insert.run(
                    index,
                    json(senses[index]),
                    id
                );

                imported += result.changes;
            }
        }

        return imported;
    });

    const total = transaction();

    log(`Registros complementares JMdict: ${total}`);
}

function createWordKanjiRelations(db: Database.Database) {
    const kanjiRows = db.prepare(`
        SELECT id, literal FROM kanji
    `).all() as { id: number; literal: string }[];

    const kanjiMap = new Map(
        kanjiRows.map(item => [item.literal, item.id])
    );

    const forms = db.prepare(`
        SELECT word_id, text
        FROM word_forms
        WHERE form_type = 'kanji'
    `).all() as { word_id: number; text: string }[];

    const insert = db.prepare(`
        INSERT OR IGNORE INTO word_kanji (
            word_id,
            kanji_id,
            position
        ) VALUES (?, ?, ?)
    `);

    const transaction = db.transaction(() => {
        for (const form of forms) {
            const characters = Array.from(form.text);

            characters.forEach((character, position) => {
                const kanjiId = kanjiMap.get(character);

                if (kanjiId) {
                    insert.run(
                        form.word_id,
                        kanjiId,
                        position
                    );
                }
            });
        }
    });

    transaction();

    log('Relacionamentos entre palavras e kanjis criados');
}

function createTokenizer(): Promise<any> {
    return new Promise((resolve, reject) => {
        kuromoji.builder({
            dicPath: path.join(
                ROOT,
                'node_modules/kuromoji/dict'
            )
        }).build((error, tokenizer) => {
            if (error) {
                reject(error);
                return;
            }

            resolve(tokenizer);
        });
    });
}

async function importTatoeba(
    db: Database.Database,
    tokenizer: any
) {
    log('Iniciando importação Tatoeba...');

    // Índice em memória: expressão japonesa -> IDs das palavras.
    const forms = db.prepare(`
        SELECT word_id, text
        FROM word_forms
    `).all() as { word_id: number; text: string }[];

    const wordMap = new Map<string, Set<number>>();

    for (const form of forms) {
        if (!wordMap.has(form.text)) {
            wordMap.set(form.text, new Set());
        }

        wordMap.get(form.text)!.add(form.word_id);
    }

    const insertExample = db.prepare(`
        INSERT OR IGNORE INTO examples (
            tatoeba_id,
            translation_id,
            japanese,
            english,
            source,
            license
        ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    const findExample = db.prepare(`
        SELECT id FROM examples
        WHERE tatoeba_id = ?
    `);

    const insertRelation = db.prepare(`
        INSERT OR IGNORE INTO example_words (
            example_id,
            word_id,
            surface,
            base_form,
            position
        ) VALUES (?, ?, ?, ?, ?)
    `);

    const stream = fs.createReadStream(
        FILES.tatoeba,
        { encoding: 'utf8' }
    );

    const rl = readline.createInterface({
        input: stream,
        crlfDelay: Infinity
    });

    let processed = 0;
    let invalid = 0;
    let pending: JsonObject[] = [];

    const saveBatch = db.transaction((batch: JsonObject[]) => {
        for (const example of batch) {
            const result = insertExample.run(
                example.id,
                example.translationId ?? null,
                example.japanese,
                example.english ?? null,
                example.source ?? 'Tatoeba',
                example.license ?? null
            );

            // Ignora registros duplicados.
            if (result.changes === 0) continue;

            const exampleId = Number(result.lastInsertRowid);

            const tokens = tokenizer.tokenize(
                example.japanese
            );

            for (let index = 0; index < tokens.length; index++) {
                const token = tokens[index];

                const surface = token.surface_form;
                const baseForm =
                    token.basic_form &&
                    token.basic_form !== '*'
                        ? token.basic_form
                        : surface;

                // Primeiro procura a forma-base.
                // Depois utiliza a forma encontrada na frase.
                const matchedIds = new Set<number>();

                for (const candidate of [baseForm, surface]) {
                    const ids = wordMap.get(candidate);

                    if (ids) {
                        for (const id of ids) {
                            matchedIds.add(id);
                        }
                    }
                }

                for (const wordId of matchedIds) {
                    insertRelation.run(
                        exampleId,
                        wordId,
                        surface,
                        baseForm,
                        token.word_position ?? index + 1
                    );
                }
            }
        }
    });

    for await (const line of rl) {
        if (!line.trim()) continue;

        try {
            const example = JSON.parse(line);

            if (
                example.id == null ||
                !example.japanese
            ) {
                invalid++;
                continue;
            }

            pending.push(example);
            processed++;

            if (pending.length >= 500) {
                saveBatch(pending);
                pending = [];
            }

            if (processed % 10000 === 0) {
                log(`Tatoeba processado: ${processed}`);
            }

        } catch (error) {
            invalid++;
        }
    }

    if (pending.length > 0) {
        saveBatch(pending);
    }

    log(`Tatoeba concluído: ${processed} frases`);
    log(`Registros inválidos: ${invalid}`);
}

function createMetadata(db: Database.Database) {
    const insert = db.prepare(`
        INSERT OR REPLACE INTO dictionary_metadata (
            key,
            value
        ) VALUES (?, ?)
    `);

    const metadata = {
        database_version: '1',
        built_at: new Date().toISOString(),
        sources: JSON.stringify([
            'JMdict',
            'KANJIDIC2',
            'Tatoeba'
        ]),
        tokenizer: 'Kuromoji'
    };

    const transaction = db.transaction(() => {
        for (const [key, value] of Object.entries(metadata)) {
            insert.run(key, value);
        }
    });

    transaction();
}

async function main() {
    ensureDirectory(FILES.database);
        
    for (const suffix of ['', '-wal', '-shm']) {
        const file = FILES.database + suffix;

        if (fs.existsSync(file)) {
            fs.unlinkSync(file);
        }
    }
    const db = new Database(FILES.database);

    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');

    db.exec(schema);

    try {
        const jmdictAll = readJson(FILES.jmdictAll);
        const jmdictCommon = readJson(FILES.jmdictCommon);
        const jmdictExamples = readJson(FILES.jmdictExamples);
        const kanjidic = readJson(FILES.kanjidic);

        const commonIds = new Set(
            getWords(jmdictCommon).map(word => String(word.id))
        );

        log(`Palavras JMdict: ${getWords(jmdictAll).length}`);
        log(`Palavras common: ${commonIds.size}`);

        importJMDict(db, getWords(jmdictAll), commonIds);

        importKANJIDIC(db, getKanjis(kanjidic));

        importJMDictExamples(
            db,
            getWords(jmdictExamples)
        );

        createWordKanjiRelations(db);

        const tokenizer = await createTokenizer();

        await importTatoeba(db, tokenizer);

        createMetadata(db);

        db.pragma('optimize');

        const counts = {
            words: db.prepare('SELECT COUNT(*) AS total FROM words').get(),
            kanji: db.prepare('SELECT COUNT(*) AS total FROM kanji').get(),
            examples: db.prepare('SELECT COUNT(*) AS total FROM examples').get(),
            relations: db.prepare('SELECT COUNT(*) AS total FROM example_words').get()
        };

        log('Importação concluída!');
        console.log(counts);
        log(`Banco criado em: ${FILES.database}`);

    } finally {
        db.pragma('wal_checkpoint(TRUNCATE)');
        db.close();
    }
    
}

// Implementações dos importadores nas próximas seções.

main().catch(error => {
    console.error('Erro ao construir o banco:', error);
    process.exitCode = 1;
});


/* run afterwards to check
-- Quantidade de palavras
SELECT COUNT(*) FROM words;

-- Palavras comuns
SELECT COUNT(*) FROM words
WHERE is_common = 1;

-- Kanjis
SELECT COUNT(*) FROM kanji;

-- Significados
SELECT COUNT(*) FROM meanings;

-- Frases Tatoeba
SELECT COUNT(*) FROM examples;

-- Relacionamentos de frases
SELECT COUNT(*) FROM example_words;

-- test a word
SELECT
    w.primary_expression,
    w.primary_reading,
    m.meaning
FROM words w
JOIN senses s ON s.word_id = w.id
JOIN meanings m ON m.sense_id = s.id
WHERE w.primary_expression = '食べる';

*/