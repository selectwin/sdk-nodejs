/**
 * The Selectwin client — the hand-written DX shell over the generated core.
 *
 *   import { Selectwin } from '@selectwin/sdk';
 *   const sw = new Selectwin(process.env.SELECTWIN_API_KEY!);
 *   const tx = await sw.transactions.create({ ... });   // Stripe-style aliases
 *   await sw.transactions.raw.createTransaction({ ... }); // or the raw operationId
 *
 * One `Configuration` (custom fetch + middleware) is shared by every namespace,
 * so auth, retries, idempotency and typed-error mapping apply everywhere.
 */
import { Configuration } from './generated/runtime';
import {
  AddressesApi,
  CardsApi,
  CheckoutApi,
  CouponsApi,
  CustomersApi,
  FinanceApi,
  ProductsApi,
  ProductsVariantsApi,
  ReceivablesApi,
  SimulatorsApi,
  SubscriptionsApi,
  TransactionsApi,
  UtilsApi,
  WalletsApi,
  WebhooksApi,
  WithdrawalsApi,
} from './generated/apis';
import {
  AddressesNamespace,
  CardsNamespace,
  CheckoutNamespace,
  CouponsNamespace,
  CustomersNamespace,
  FinanceNamespace,
  ProductsNamespace,
  ProductsVariantsNamespace,
  ReceivablesNamespace,
  SimulatorsNamespace,
  SubscriptionsNamespace,
  TransactionsNamespace,
  UtilsNamespace,
  WalletsNamespace,
  WebhooksNamespace,
  WithdrawalsNamespace,
} from './namespaces';
import { buildMiddleware, createFetchApi } from './http';
import { constructEvent } from './webhooks';

export const SDK_VERSION = '0.1.0';
const DEFAULT_BASE_PATH = 'https://api.selectwin.io';

export interface SelectwinOptions {
  /** Override the base URL (e.g. a mock server). Default `https://api.selectwin.io`. */
  baseUrl?: string;
  /** Retries for 429/5xx/network errors. Default `2`. */
  maxRetries?: number;
  /** Per-request timeout in ms. Default `60000`. Set `0` to disable. */
  timeoutMs?: number;
  /** Custom fetch implementation (edge/workers/tests). Default: global `fetch`. */
  fetch?: typeof fetch;
  /** Override the `User-Agent`. */
  userAgent?: string;
}

/** The webhooks namespace also carries the `constructEvent` verification helper. */
export type WebhooksResource = WebhooksNamespace & { constructEvent: typeof constructEvent };

export class Selectwin {
  readonly addresses: AddressesNamespace;
  readonly cards: CardsNamespace;
  readonly checkout: CheckoutNamespace;
  readonly coupons: CouponsNamespace;
  readonly customers: CustomersNamespace;
  readonly finance: FinanceNamespace;
  readonly products: ProductsNamespace;
  readonly variants: ProductsVariantsNamespace;
  readonly receivables: ReceivablesNamespace;
  readonly simulators: SimulatorsNamespace;
  readonly subscriptions: SubscriptionsNamespace;
  readonly transactions: TransactionsNamespace;
  readonly utils: UtilsNamespace;
  readonly wallets: WalletsNamespace;
  readonly withdrawals: WithdrawalsNamespace;
  /** Webhook endpoints/events/dispatches management + `constructEvent`. */
  readonly webhooks: WebhooksResource;

  constructor(apiKey: string, options: SelectwinOptions = {}) {
    if (!apiKey) throw new Error('Selectwin: an API key is required (sk_test_… or sk_live_…).');

    const timeoutMs = options.timeoutMs === undefined ? 60_000 : options.timeoutMs;
    const config = new Configuration({
      basePath: options.baseUrl ?? DEFAULT_BASE_PATH,
      apiKey: () => apiKey, // sent as the `selectkey` header by the generated code
      fetchApi: createFetchApi({
        maxRetries: options.maxRetries ?? 2,
        timeoutMs: timeoutMs || undefined,
        fetchImpl: options.fetch,
      }),
      middleware: [buildMiddleware(options.userAgent ?? `selectwin-node/${SDK_VERSION}`)],
    });

    this.addresses = new AddressesNamespace(new AddressesApi(config));
    this.cards = new CardsNamespace(new CardsApi(config));
    this.checkout = new CheckoutNamespace(new CheckoutApi(config));
    this.coupons = new CouponsNamespace(new CouponsApi(config));
    this.customers = new CustomersNamespace(new CustomersApi(config));
    this.finance = new FinanceNamespace(new FinanceApi(config));
    this.products = new ProductsNamespace(new ProductsApi(config));
    this.variants = new ProductsVariantsNamespace(new ProductsVariantsApi(config));
    this.receivables = new ReceivablesNamespace(new ReceivablesApi(config));
    this.simulators = new SimulatorsNamespace(new SimulatorsApi(config));
    this.subscriptions = new SubscriptionsNamespace(new SubscriptionsApi(config));
    this.transactions = new TransactionsNamespace(new TransactionsApi(config));
    this.utils = new UtilsNamespace(new UtilsApi(config));
    this.wallets = new WalletsNamespace(new WalletsApi(config));
    this.withdrawals = new WithdrawalsNamespace(new WithdrawalsApi(config));

    const webhooks = new WebhooksNamespace(new WebhooksApi(config)) as WebhooksResource;
    webhooks.constructEvent = constructEvent;
    this.webhooks = webhooks;
  }
}
