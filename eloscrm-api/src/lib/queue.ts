import { Queue, Worker, type JobsOptions, type Processor } from "bullmq";
import { env } from "../env.js";

/**
 * Filas do WhatsApp. Sem `REDIS_URL` **nada aqui é criado** e `enqueue` executa o processador na
 * hora — é o que mantém teste e CI sem infra, e o que torna a suíte determinística (nada de esperar
 * worker). Em produção o Redis é obrigatório: inline, o download de mídia trava a resposta do
 * webhook e a uazapi passa a acumular retentativa.
 */

const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 1000 },
};

// separa as filas por ambiente para um worker de dev não consumir job de outro banco
const prefix = `eloscrm:${env.NODE_ENV}`;

export const queueEnabled = () => Boolean(env.REDIS_URL);

const queues = new Map<string, Queue>();

const getQueue = (name: string) => {
  if (!env.REDIS_URL) return null;
  const existing = queues.get(name);
  if (existing) return existing;
  const queue = new Queue(name, {
    connection: { url: env.REDIS_URL },
    prefix,
    defaultJobOptions,
  });
  queues.set(name, queue);
  return queue;
};

// registrado por createWorker e consultado pelo enqueue inline: sem Redis, é aqui que o
// processador é encontrado
const processors = new Map<string, Processor>();

export const createWorker = <T>(name: string, processor: Processor<T>, concurrency = 5) => {
  processors.set(name, processor as Processor);
  if (!env.REDIS_URL) return null;
  return new Worker<T>(name, processor, {
    connection: { url: env.REDIS_URL },
    prefix,
    concurrency,
  });
};

export const enqueue = async <T>(name: string, data: T) => {
  const queue = getQueue(name);
  if (queue) {
    await queue.add(name, data);
    return;
  }
  const processor = processors.get(name);
  if (!processor) throw new Error(`fila "${name}" sem processador registrado`);
  // BullMQ passa um Job; inline só o `data` importa, e é o que os processadores consomem
  await processor({ data } as Parameters<Processor>[0]);
};

export const closeQueues = async () => {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
};
