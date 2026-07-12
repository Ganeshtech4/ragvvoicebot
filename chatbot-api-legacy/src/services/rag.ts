import { pool } from '../db/pg';

interface KBDocument {
  title: string;
  content: string;
}

/**
 * Retrieves the most relevant knowledge base documents for a specific tenant and user query.
 */
export async function retrieveRelevantContext(tenantId: string, query: string): Promise<string> {
  try {
    // 1. Fetch all documents scoped to this tenant
    const res = await pool.query(
      'SELECT title, content FROM kb_documents WHERE tenant_id = $1',
      [tenantId]
    );

    const docs: KBDocument[] = res.rows;
    if (docs.length === 0) {
      return '';
    }

    // 2. Score documents based on keyword matching
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    
    const scoredDocs = docs.map(doc => {
      let score = 0;
      const combinedText = `${doc.title} ${doc.content}`.toLowerCase();
      
      queryWords.forEach(word => {
        const regex = new RegExp(word, 'g');
        const count = (combinedText.match(regex) || []).length;
        score += count;
      });

      return { doc, score };
    });

    // 3. Sort by score descending and take the top matching documents
    const topDocs = scoredDocs
      .filter(item => item.score > 0 || queryWords.length === 0) // fallback to all docs if no keywords matched
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(item => `Title: ${item.doc.title}\nContent: ${item.doc.content}`);

    return topDocs.join('\n\n');
  } catch (error) {
    console.error('Error retrieving RAG context:', error);
    return '';
  }
}
