
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const inputDir = path.resolve('data/tatoeba-raw');
const outputDir = path.resolve('data/tatoeba');

const sentencesFile = path.join(inputDir, 'sentences.csv');
const linksFile = path.join(inputDir, 'links.csv');
const outputFile = path.join(outputDir, 'sentences.jsonl');

type Sentence = {
  id: number;
  lang: string;
  text: string;
};

async function readLines(filePath: string) {
  const stream = fs.createReadStream(filePath, {
    encoding: 'utf8'
  });

  return readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });
}

async function convert() {
  fs.mkdirSync(outputDir, { recursive: true });

  // 1. Carrega somente frases japonesas e inglesas.
  const sentences = new Map<number, Sentence>();

  const sentenceLines = await readLines(sentencesFile);

  for await (const line of sentenceLines) {
    const firstTab = line.indexOf('\t');
    const secondTab = line.indexOf('\t', firstTab + 1);

    if (firstTab < 0 || secondTab < 0) continue;

    const id = Number(line.slice(0, firstTab));
    const lang = line.slice(firstTab + 1, secondTab);

    if (lang !== 'jpn' && lang !== 'eng') continue;

    const text = line.slice(secondTab + 1);

    if (!Number.isSafeInteger(id) || !text) continue;

    sentences.set(id, { id, lang, text });
  }

  console.log(`Frases carregadas: ${sentences.size}`);

  // 2. Relaciona frases japonesas com traduções inglesas.
  const output = fs.createWriteStream(outputFile, {
    encoding: 'utf8'
  });

  const seen = new Set<string>();
  let count = 0;

  const links = await readLines(linksFile);

  for await (const line of links) {
    const [first, second] = line.split('\t');

    const firstId = Number(first);
    const secondId = Number(second);

    if (!Number.isSafeInteger(firstId) ||
        !Number.isSafeInteger(secondId)) {
      continue;
    }

    const a = sentences.get(firstId);
    const b = sentences.get(secondId);

    if (!a || !b) continue;

    let japanese: Sentence;
    let english: Sentence;

    if (a.lang === 'jpn' && b.lang === 'eng') {
      japanese = a;
      english = b;
    } else if (a.lang === 'eng' && b.lang === 'jpn') {
      japanese = b;
      english = a;
    } else {
      continue;
    }

    // Evita duplicação dos links recíprocos.
    const pairKey = `${japanese.id}:${english.id}`;

    if (seen.has(pairKey)) continue;

    seen.add(pairKey);

    const record = {
      id: japanese.id,
      translationId: english.id,
      japanese: japanese.text,
      english: english.text,
      source: 'Tatoeba',
      license: 'CC BY 2.0 FR'
    };

    if (!output.write(JSON.stringify(record) + '\n')) {
      await new Promise<void>(resolve =>
        output.once('drain', resolve)
      );
    }

    count++;

    if (count % 10000 === 0) {
      console.log(`Pares convertidos: ${count}`);
    }
  }

  await new Promise<void>((resolve, reject) => {
    output.end(resolve);
    output.on('error', reject);
  });

  console.log(`Conversão concluída: ${count} pares.`);
  console.log(`Arquivo: ${outputFile}`);
}

convert().catch(console.error);
