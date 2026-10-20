import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { gunzipSync, gzipSync } from 'node:zlib';
import forge from 'node-forge';
import { HttpsNfseTransport } from '../../src/modules/fiscal/nfse.transport';
import { certificate } from './sefaz-simulator';

/**
 * Sefin Nacional simulada para os testes da NFS-e (F5-13.d): HTTPS que pede o certificado do
 * cliente, com as rotas do manual da API (emissão, consulta pela DPS e pela chave, convênio do
 * município). As mensagens seguem o formato da dúvida D-036.
 */
export type SefinMode = 'normal' | 'rejeita' | 'fora' | 'perde';

export class SefinSimulator {
  mode: SefinMode = 'normal';
  /** O convênio do município está ativo no Sistema Nacional? */
  agreementActive = true;
  readonly calls: { method: string; path: string; dps?: string }[] = [];
  /** NFS-e geradas, pelo Id da DPS. */
  readonly generated = new Map<string, { key: string; xml: string }>();
  /** Cancelamentos registrados (F5-13.g): chave e o pedido de evento recebido. */
  readonly cancelled = new Map<string, string>();
  /** O município recusa o cancelamento por prazo (E0822)? */
  cancelExpired = false;
  private server: Server | null = null;
  private seq = 0;
  private readonly ac = certificate('AC SEFIN SIMULADA', null, null);
  private readonly tls = certificate('127.0.0.1', this.ac.cert, this.ac.keys.privateKey);

  async start() {
    this.server = createServer(
      {
        key: forge.pki.privateKeyToPem(this.tls.keys.privateKey),
        cert: forge.pki.certificateToPem(this.tls.cert),
        requestCert: true,
        rejectUnauthorized: false,
      },
      (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const path = (req.url ?? '/').replace(/^\/API\/SefinNacional/, '');
          // DANFSE do ADN: o PDF da NFS-e gerada.
          const danfse = /^\/danfse\/(\d{50})$/.exec(path);
          if (req.method === 'GET' && danfse) {
            this.calls.push({ method: 'GET', path });
            const known = [...this.generated.values()].some((g) => g.key === danfse[1]);
            if (!known) return void res.writeHead(404).end();
            return void res
              .writeHead(200, { 'Content-Type': 'application/pdf' })
              .end(Buffer.from('%PDF-1.4\n% DANFSE simulado\n%%EOF\n'));
          }
          const { status, json } = this.respond(
            req.method ?? 'GET',
            req.url ?? '/',
            Buffer.concat(chunks).toString('utf8'),
          );
          res
            .writeHead(status, { 'Content-Type': 'application/json' })
            .end(json === null ? '' : JSON.stringify(json));
        });
      },
    );
    await new Promise<void>((ok) => this.server!.listen(0, '127.0.0.1', () => ok()));
  }

  transport() {
    const port = (this.server!.address() as AddressInfo).port;
    return new HttpsNfseTransport({
      ca: [forge.pki.certificateToPem(this.ac.cert)],
      timeoutMs: 5000,
      rewriteUrl: (url) => `https://127.0.0.1:${port}${new URL(url).pathname}`,
    });
  }

  async stop() {
    await new Promise((ok) => this.server?.close(ok));
  }

  private nfse(dps: string) {
    const id = /Id="(DPS\d{42})"/.exec(dps)?.[1] ?? '';
    const key = `${id.slice(3, 10)}2${String(++this.seq).padStart(42, '0')}`.slice(0, 50);
    const xml = `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${key}"><nNFSe>${this.seq}</nNFSe>${dps}</infNFSe></NFSe>`;
    this.generated.set(id, { key, xml });
    return { id, key, xml };
  }

  private respond(method: string, url: string, body: string): { status: number; json: unknown } {
    const path = url.replace(/^\/API\/SefinNacional/, '');
    if (this.mode === 'fora') {
      this.calls.push({ method, path });
      return { status: 503, json: null };
    }
    if (method === 'POST' && path === '/nfse') {
      const dps = gunzipSync(
        Buffer.from((JSON.parse(body) as { dpsXmlGZipB64: string }).dpsXmlGZipB64, 'base64'),
      ).toString('utf8');
      this.calls.push({ method, path, dps });
      if (this.mode === 'rejeita') {
        return {
          status: 400,
          json: {
            erros: [
              {
                Codigo: 'E0015',
                Descricao: 'A data de competência não pode ser posterior à data de emissão.',
              },
            ],
          },
        };
      }
      const { key, xml } = this.nfse(dps);
      if (this.mode === 'perde') return { status: 503, json: null };
      return {
        status: 201,
        json: { chaveAcesso: key, nfseXmlGZipB64: gzipSync(Buffer.from(xml)).toString('base64') },
      };
    }
    // Pedido de registro de evento (cancelamento 101101).
    const eventMatch = /^\/nfse\/(\d{50})\/eventos$/.exec(path);
    if (method === 'POST' && eventMatch) {
      const key = eventMatch[1]!;
      const request = gunzipSync(
        Buffer.from(
          (JSON.parse(body) as { pedidoRegistroEventoXmlGZipB64: string })
            .pedidoRegistroEventoXmlGZipB64,
          'base64',
        ),
      ).toString('utf8');
      this.calls.push({ method, path, dps: request });
      const exists = [...this.generated.values()].some((g) => g.key === key);
      const erro = (Codigo: string, Descricao: string) => ({
        status: 400,
        json: { erros: [{ Codigo, Descricao }] },
      });
      if (!exists) return erro('E0840', 'NFS-e não encontrada para o evento.');
      if (this.cancelled.has(key)) return erro('E0802', 'Já existe um evento de cancelamento.');
      if (this.cancelExpired) {
        return erro(
          'E0822',
          'O prazo para o cancelamento da NFS-e expirou, conforme parametrização do município emissor da NFS-e.',
        );
      }
      this.cancelled.set(key, request);
      const evento =
        '<evento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infEvento Id="EVT' +
        key +
        '101101001"><verAplic>SIMULADA</verAplic><ambGer>2</ambGer><nSeqEvento>1</nSeqEvento>' +
        '<dhProc>2026-10-19T10:05:00-03:00</dhProc><nDFSe>1</nDFSe>' +
        request.replace(/^<\?xml[^>]*>/, '') +
        '</infEvento></evento>';
      return {
        status: 201,
        json: { eventoXmlGZipB64: gzipSync(Buffer.from(evento)).toString('base64') },
      };
    }
    this.calls.push({ method, path });
    const dpsMatch = /^\/dps\/(DPS\d{42})$/.exec(path);
    if (method === 'GET' && dpsMatch) {
      const found = this.generated.get(dpsMatch[1]!);
      return found
        ? { status: 200, json: { chaveAcesso: found.key } }
        : { status: 404, json: null };
    }
    const keyMatch = /^\/nfse\/(\d{50})$/.exec(path);
    if (method === 'GET' && keyMatch) {
      const found = [...this.generated.values()].find((g) => g.key === keyMatch[1]);
      return found
        ? {
            status: 200,
            json: {
              chaveAcesso: found.key,
              nfseXmlGZipB64: gzipSync(Buffer.from(found.xml)).toString('base64'),
            },
          }
        : { status: 404, json: null };
    }
    // ADN Parâmetros Municipais, no formato da especificação oficial.
    if (method === 'GET' && /^\/parametrizacao\/\d{7}\/convenio$/.test(path)) {
      return {
        status: 200,
        json: {
          parametrosConvenio: { aderenteAmbienteNacional: this.agreementActive ? 1 : 0 },
          mensagem: 'Parâmetros do convênio recuperados com sucesso.',
        },
      };
    }
    return { status: 404, json: null };
  }
}
