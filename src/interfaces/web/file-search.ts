import { DomainClass } from "../../domain/domain-class.ts";
import type { ReviewSourceFile } from "../../domain/review/review.ts";

type IndexedFile = {
  file: ReviewSourceFile;
  index: number;
  path: string;
  basename: string;
  compactBasename: string;
  stem: string;
  words: string[];
  pathSegmentCount: number;
};

type SearchTerm = {
  value: string;
  numeric: boolean;
  maximumDistance: number;
  distanceRows: [Uint16Array, Uint16Array, Uint16Array];
};

export class FileSearchClass extends DomainClass<{}, {}> {
  private readonly indexes = new WeakMap<ReviewSourceFile[], IndexedFile[]>();

  public prepare(params: { files: ReviewSourceFile[] }): void {
    this.indexFiles(params.files);
  }

  public search(params: { files: ReviewSourceFile[]; query: string }): ReviewSourceFile[] {
    const query = this.normalize(params.query).trim();
    if (query.length === 0) {
      return params.files;
    }

    const terms = query
      .split(/[\s/._-]+/)
      .filter(Boolean)
      .map((value): SearchTerm => {
        const maximumDistance = value.length < 3 ? 0 : value.length >= 6 ? 2 : 1;
        const rowLength = value.length + maximumDistance + 1;
        return {
          value,
          numeric: /^\d+$/.test(value),
          maximumDistance,
          distanceRows: [
            new Uint16Array(rowLength),
            new Uint16Array(rowLength),
            new Uint16Array(rowLength),
          ],
        };
      });
    if (terms.length === 0) {
      return params.files;
    }

    const compactQuery = terms.map((term) => term.value).join("");
    const indexedFiles = this.indexFiles(params.files);
    let matches: { indexedFile: IndexedFile; score: number }[] | null = null;
    for (const term of this.orderTerms(terms, indexedFiles)) {
      const candidates = matches ?? indexedFiles;
      const nextMatches: { indexedFile: IndexedFile; score: number }[] = [];
      for (const candidate of candidates) {
        const indexedFile = "indexedFile" in candidate ? candidate.indexedFile : candidate;
        const previousScore = "score" in candidate ? candidate.score : 0;
        const termScore = this.scoreTerm(indexedFile, term);
        if (termScore !== null) {
          nextMatches.push({ indexedFile, score: previousScore + termScore });
        }
      }
      matches = nextMatches;
      if (matches.length === 0) {
        break;
      }
    }
    const results = (matches ?? []).map(({ indexedFile, score }) => ({
      file: indexedFile.file,
      index: indexedFile.index,
      score:
        score +
        (compactQuery === indexedFile.compactBasename ? 600 : 0) -
        indexedFile.pathSegmentCount * 2 -
        indexedFile.path.length / 100,
    }));
    results.sort((left, right) => right.score - left.score || left.index - right.index);
    return results.map((result) => result.file);
  }

  private indexFiles(files: ReviewSourceFile[]): IndexedFile[] {
    const cachedIndex = this.indexes.get(files);
    if (cachedIndex) {
      return cachedIndex;
    }

    const index = files.map((file, fileIndex): IndexedFile => {
      const path = this.normalize(file.location);
      const pathSegments = path.split("/").filter(Boolean);
      const basename = pathSegments.at(-1) ?? path;
      const extensionIndex = basename.lastIndexOf(".");
      return {
        file,
        index: fileIndex,
        path,
        basename,
        compactBasename: basename.replace(/[._-]+/g, ""),
        stem: extensionIndex > 0 ? basename.slice(0, extensionIndex) : basename,
        words: path.split(/[/._-]+/).filter(Boolean),
        pathSegmentCount: pathSegments.length,
      };
    });
    this.indexes.set(files, index);
    return index;
  }

  private orderTerms(terms: SearchTerm[], indexedFiles: IndexedFile[]): SearchTerm[] {
    const sampleSize = Math.min(indexedFiles.length, 512);
    return terms
      .map((term, index) => {
        let sampleMatches = 0;
        for (let sampleIndex = 0; sampleIndex < sampleSize; sampleIndex += 1) {
          if (indexedFiles[sampleIndex]?.path.includes(term.value)) {
            sampleMatches += 1;
          }
        }
        return { term, index, sampleMatches };
      })
      .sort(
        (left, right) =>
          Number(right.term.numeric) - Number(left.term.numeric) ||
          left.sampleMatches - right.sampleMatches ||
          right.term.value.length - left.term.value.length ||
          left.index - right.index,
      )
      .map((entry) => entry.term);
  }

  private scoreTerm(indexedFile: IndexedFile, term: SearchTerm): number | null {
    let bestScore = this.scoreCandidate(term, indexedFile.stem, true);
    if (bestScore !== null) {
      bestScore += 220;
    }

    const basenameScore = this.scoreCandidate(term, indexedFile.basename, true);
    if (basenameScore !== null) {
      bestScore = Math.max(bestScore ?? Number.NEGATIVE_INFINITY, basenameScore + 180);
    }

    for (let index = 0; index < indexedFile.words.length; index += 1) {
      const wordScore = this.scoreCandidate(term, indexedFile.words[index] ?? "", true);
      if (wordScore !== null) {
        const bonus = 120 + (index === indexedFile.words.length - 1 ? 40 : 0);
        bestScore = Math.max(bestScore ?? Number.NEGATIVE_INFINITY, wordScore + bonus);
      }
    }

    const pathScore = this.scoreCandidate(term, indexedFile.path, false);
    return pathScore === null
      ? bestScore
      : Math.max(bestScore ?? Number.NEGATIVE_INFINITY, pathScore);
  }

  private scoreCandidate(
    term: SearchTerm,
    candidate: string,
    allowEditDistance: boolean,
  ): number | null {
    if (term.value === candidate) {
      return 1_200;
    }
    if (candidate.startsWith(term.value)) {
      return 1_000 - (candidate.length - term.value.length) * 2;
    }

    const substringIndex = candidate.indexOf(term.value);
    if (substringIndex >= 0) {
      const boundaryBonus =
        substringIndex === 0 || this.isSeparator(candidate[substringIndex - 1] ?? "") ? 120 : 0;
      return 760 + boundaryBonus - substringIndex * 2 - (candidate.length - term.value.length);
    }

    const subsequenceScore = this.scoreSubsequence(term.value, candidate);
    const editDistanceScore = allowEditDistance ? this.scoreEditDistance(term, candidate) : null;
    if (subsequenceScore === null) {
      return editDistanceScore;
    }
    if (editDistanceScore === null) {
      return subsequenceScore;
    }
    return Math.max(subsequenceScore, editDistanceScore);
  }

  private scoreSubsequence(query: string, candidate: string): number | null {
    let candidateIndex = 0;
    let firstMatch = -1;
    let previousMatch = -2;
    let adjacencyBonus = 0;
    let boundaryBonus = 0;

    for (const character of query) {
      const matchIndex = candidate.indexOf(character, candidateIndex);
      if (matchIndex < 0) {
        return null;
      }
      if (firstMatch < 0) {
        firstMatch = matchIndex;
      }
      if (matchIndex === previousMatch + 1) {
        adjacencyBonus += 28;
      }
      const isBoundaryMatch = matchIndex === 0 || this.isSeparator(candidate[matchIndex - 1] ?? "");
      if (isBoundaryMatch) {
        boundaryBonus += 36;
      }
      previousMatch = matchIndex;
      candidateIndex = matchIndex + 1;
    }

    const span = previousMatch - firstMatch + 1;
    const gapPenalty = Math.max(0, span - query.length) * 8;
    const lengthPenalty = Math.max(0, candidate.length - query.length) * 0.8;
    return 420 + query.length * 18 + adjacencyBonus + boundaryBonus - gapPenalty - lengthPenalty;
  }

  private scoreEditDistance(term: SearchTerm, candidate: string): number | null {
    const isOutsideDistanceRange =
      term.maximumDistance === 0 ||
      Math.abs(term.value.length - candidate.length) > term.maximumDistance;
    if (isOutsideDistanceRange) {
      return null;
    }
    const distance = this.damerauLevenshtein(term, candidate);
    return distance <= term.maximumDistance ? 620 - distance * 100 - candidate.length : null;
  }

  private damerauLevenshtein(term: SearchTerm, candidate: string): number {
    let previousPrevious = term.distanceRows[0];
    let previous = term.distanceRows[1];
    let current = term.distanceRows[2];
    for (let candidateIndex = 0; candidateIndex <= candidate.length; candidateIndex += 1) {
      previous[candidateIndex] = candidateIndex;
    }

    for (let queryIndex = 1; queryIndex <= term.value.length; queryIndex += 1) {
      current[0] = queryIndex;
      for (let candidateIndex = 1; candidateIndex <= candidate.length; candidateIndex += 1) {
        const substitutionCost =
          term.value[queryIndex - 1] === candidate[candidateIndex - 1] ? 0 : 1;
        current[candidateIndex] = Math.min(
          previous[candidateIndex] + 1,
          current[candidateIndex - 1] + 1,
          previous[candidateIndex - 1] + substitutionCost,
        );
        const isTransposition =
          queryIndex > 1 &&
          candidateIndex > 1 &&
          term.value[queryIndex - 1] === candidate[candidateIndex - 2] &&
          term.value[queryIndex - 2] === candidate[candidateIndex - 1];
        if (isTransposition) {
          current[candidateIndex] = Math.min(
            current[candidateIndex],
            previousPrevious[candidateIndex - 2] + 1,
          );
        }
      }
      [previousPrevious, previous, current] = [previous, current, previousPrevious];
    }

    return previous[candidate.length];
  }

  private isSeparator(value: string): boolean {
    return value === "/" || value === "." || value === "_" || value === "-";
  }

  private normalize(value: string): string {
    return value.normalize("NFKD").replace(/\p{M}/gu, "").replaceAll("\\", "/").toLowerCase();
  }
}

export const FileSearch = new FileSearchClass({}, {});
