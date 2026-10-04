import { Api, Row } from './types'
import { Rng, pastMs, iso, WORLD_NOW } from '../gen/prng'
import { address, company, later, money, person, resetUnique, sentences, slug } from '../gen/helpers'
import { COLORS, PRODUCT_CATEGORIES, REVIEW_LINES, REVIEW_TITLES, CITIES } from '../gen/words'

export const storeApi: Api = {
  name: 'store',
  title: 'Store',
  tagline: 'An online shop: products, customers, orders, reviews and stock.',
  doc: 'Two thousand products in eight categories, eight hundred customers, three thousand orders with their line items, reviews, three warehouses of stock and open carts. Orders move through a lifecycle (pending → paid → shipped → delivered) and the live stream shows orders moving.',
  collections: [
    {
      name: 'categories',
      singular: 'category',
      doc: 'The eight product categories.',
      count: 8,
      fields: [
        { name: 'name', type: 'string', required: true, example: 'Audio' },
        { name: 'slug', type: 'string', required: true, example: 'audio' },
        { name: 'description', type: 'text' },
        { name: 'product_count', type: 'int', readonly: true, doc: 'Seed products in the category.' },
      ],
      relations: [{ name: 'products', kind: 'hasMany', collection: 'products', field: 'category_id' }],
    },
    {
      name: 'products',
      singular: 'product',
      doc: 'What the store sells. Prices are in USD.',
      count: 2000,
      sort: 'id',
      preview: ['id', 'sku', 'name', 'category_id', 'price', 'in_stock', 'rating'],
      fields: [
        { name: 'sku', type: 'string', required: true, example: 'AUD-4F7K2M', doc: 'Unique stock keeping unit.' },
        { name: 'name', type: 'string', required: true, example: 'Sonora Wireless Headphones' },
        { name: 'slug', type: 'string', example: 'sonora-wireless-headphones' },
        { name: 'description', type: 'text' },
        { name: 'category_id', type: 'ref', ref: 'categories', required: true },
        { name: 'brand', type: 'string', example: 'Sonora' },
        { name: 'price', type: 'float', required: true, min: 0, example: 149.99 },
        { name: 'compare_at_price', type: 'float', doc: 'The struck-through price on sale, or null.' },
        { name: 'currency', type: 'string', example: 'USD' },
        { name: 'color', type: 'string', example: 'Graphite' },
        { name: 'weight_g', type: 'int', min: 0 },
        { name: 'tags', type: 'json', shape: 'string[]', example: ['bluetooth', 'travel'] },
        { name: 'in_stock', type: 'bool' },
        { name: 'rating', type: 'float', readonly: true, doc: 'Average of the seed reviews, 1–5.' },
        { name: 'review_count', type: 'int', readonly: true },
        { name: 'status', type: 'enum', values: ['active', 'draft', 'archived'], example: 'active' },
      ],
      relations: [
        { name: 'category', kind: 'belongsTo', collection: 'categories', field: 'category_id' },
        { name: 'reviews', kind: 'hasMany', collection: 'reviews', field: 'product_id' },
        { name: 'inventory', kind: 'hasMany', collection: 'inventory', field: 'product_id' },
      ],
    },
    {
      name: 'customers',
      singular: 'customer',
      doc: 'People who buy. Addresses are nested objects; filter on them with a dotted name (?address.country=AR).',
      count: 800,
      preview: ['id', 'name', 'email', 'tier', 'orders_count', 'total_spent'],
      fields: [
        { name: 'name', type: 'string', required: true, example: 'Camila Fernandez' },
        { name: 'email', type: 'string', required: true, example: 'camila.fernandez@example.com' },
        { name: 'phone', type: 'string' },
        { name: 'company', type: 'string' },
        { name: 'address', type: 'json', shape: '{ line1, line2?, city, region, postal_code, country }' },
        { name: 'tier', type: 'enum', values: ['standard', 'silver', 'gold', 'platinum'] },
        { name: 'marketing_opt_in', type: 'bool' },
        { name: 'orders_count', type: 'int', readonly: true },
        { name: 'total_spent', type: 'float', readonly: true },
        { name: 'notes', type: 'text' },
      ],
      relations: [
        { name: 'orders', kind: 'hasMany', collection: 'orders', field: 'customer_id' },
        { name: 'reviews', kind: 'hasMany', collection: 'reviews', field: 'customer_id' },
      ],
    },
    {
      name: 'orders',
      singular: 'order',
      doc: 'An order and its money. Line items live in order_items (also at /orders/{id}/items and ?expand=items).',
      count: 3000,
      sort: '-placed_at',
      preview: ['id', 'number', 'customer_id', 'status', 'total', 'placed_at'],
      fields: [
        { name: 'number', type: 'string', readonly: true, example: 'SH-100042', doc: 'Human order number.' },
        { name: 'customer_id', type: 'ref', ref: 'customers', required: true },
        { name: 'status', type: 'enum', values: ['pending', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded'], example: 'paid' },
        { name: 'subtotal', type: 'float', min: 0 },
        { name: 'shipping', type: 'float', min: 0 },
        { name: 'tax', type: 'float', min: 0 },
        { name: 'discount', type: 'float', min: 0 },
        { name: 'total', type: 'float', min: 0 },
        { name: 'currency', type: 'string', example: 'USD' },
        { name: 'payment_method', type: 'enum', values: ['card', 'paypal', 'bank_transfer', 'cash_on_delivery'] },
        { name: 'shipping_address', type: 'json', shape: '{ line1, line2?, city, region, postal_code, country }' },
        { name: 'shipping_method', type: 'enum', values: ['standard', 'express', 'overnight', 'pickup'] },
        { name: 'tracking_number', type: 'string' },
        { name: 'placed_at', type: 'datetime', doc: 'Defaults to now on POST.' },
        { name: 'paid_at', type: 'datetime' },
        { name: 'shipped_at', type: 'datetime' },
        { name: 'delivered_at', type: 'datetime' },
        { name: 'notes', type: 'text' },
      ],
      relations: [
        { name: 'customer', kind: 'belongsTo', collection: 'customers', field: 'customer_id' },
        { name: 'items', kind: 'hasMany', collection: 'order_items', field: 'order_id' },
      ],
    },
    {
      name: 'order_items',
      singular: 'order_item',
      doc: 'One product line on an order.',
      count: 7000,
      preview: ['id', 'order_id', 'product_id', 'quantity', 'unit_price', 'line_total'],
      fields: [
        { name: 'order_id', type: 'ref', ref: 'orders', required: true },
        { name: 'product_id', type: 'ref', ref: 'products', required: true },
        { name: 'sku', type: 'string' },
        { name: 'name', type: 'string', doc: 'The product name at the time of the order.' },
        { name: 'quantity', type: 'int', required: true, min: 1, max: 999 },
        { name: 'unit_price', type: 'float', min: 0 },
        { name: 'line_total', type: 'float', min: 0 },
      ],
      relations: [
        { name: 'order', kind: 'belongsTo', collection: 'orders', field: 'order_id' },
        { name: 'product', kind: 'belongsTo', collection: 'products', field: 'product_id' },
      ],
    },
    {
      name: 'reviews',
      singular: 'review',
      doc: 'Customer reviews, 1–5 stars.',
      count: 2500,
      sort: '-created_at',
      preview: ['id', 'product_id', 'customer_id', 'rating', 'title'],
      fields: [
        { name: 'product_id', type: 'ref', ref: 'products', required: true },
        { name: 'customer_id', type: 'ref', ref: 'customers', required: true },
        { name: 'rating', type: 'int', required: true, min: 1, max: 5 },
        { name: 'title', type: 'string' },
        { name: 'body', type: 'text' },
        { name: 'verified_purchase', type: 'bool' },
        { name: 'helpful_votes', type: 'int', min: 0 },
      ],
      relations: [
        { name: 'product', kind: 'belongsTo', collection: 'products', field: 'product_id' },
        { name: 'customer', kind: 'belongsTo', collection: 'customers', field: 'customer_id' },
      ],
    },
    {
      name: 'warehouses',
      singular: 'warehouse',
      doc: 'Where stock sits.',
      count: 3,
      fields: [
        { name: 'code', type: 'string', required: true, example: 'MIA' },
        { name: 'name', type: 'string', required: true },
        { name: 'address', type: 'json', shape: '{ line1, city, region, postal_code, country }' },
        { name: 'timezone', type: 'string' },
      ],
      relations: [{ name: 'inventory', kind: 'hasMany', collection: 'inventory', field: 'warehouse_id' }],
    },
    {
      name: 'inventory',
      singular: 'inventory_level',
      doc: 'Stock of a product at a warehouse.',
      count: 6000,
      preview: ['id', 'product_id', 'warehouse_id', 'on_hand', 'reserved', 'reorder_point'],
      fields: [
        { name: 'product_id', type: 'ref', ref: 'products', required: true },
        { name: 'warehouse_id', type: 'ref', ref: 'warehouses', required: true },
        { name: 'on_hand', type: 'int', required: true, min: 0 },
        { name: 'reserved', type: 'int', min: 0 },
        { name: 'reorder_point', type: 'int', min: 0 },
        { name: 'bin', type: 'string', example: 'A-14-3' },
        { name: 'counted_at', type: 'datetime' },
      ],
      relations: [
        { name: 'product', kind: 'belongsTo', collection: 'products', field: 'product_id' },
        { name: 'warehouse', kind: 'belongsTo', collection: 'warehouses', field: 'warehouse_id' },
      ],
    },
    {
      name: 'carts',
      singular: 'cart',
      doc: 'Open shopping carts; items are a nested array, so a cart is one document.',
      count: 200,
      preview: ['id', 'customer_id', 'status', 'item_count', 'subtotal'],
      fields: [
        { name: 'customer_id', type: 'ref', ref: 'customers' },
        { name: 'session_id', type: 'string', doc: 'For anonymous carts.' },
        { name: 'status', type: 'enum', values: ['open', 'abandoned', 'converted'] },
        { name: 'items', type: 'json', shape: '{ product_id, sku, name, quantity, unit_price }[]' },
        { name: 'item_count', type: 'int', min: 0 },
        { name: 'subtotal', type: 'float', min: 0 },
        { name: 'coupon', type: 'string' },
        { name: 'last_activity_at', type: 'datetime' },
      ],
      relations: [{ name: 'customer', kind: 'belongsTo', collection: 'customers', field: 'customer_id' }],
    },
  ],
  feeds: [
    { topic: 'orders', doc: 'An order changing status (paid → shipped → delivered).', every: '4 s' },
    { topic: 'inventory', doc: 'A stock level moving at a warehouse.', every: '6 s' },
  ],
}

export function generateStore(): Record<string, Row[]> {
  resetUnique()
  const r = new Rng('store')
  const out: Record<string, Row[]> = {}

  // categories
  const categories: Row[] = PRODUCT_CATEGORIES.map((c, i) => ({
    id: i + 1,
    name: c.name,
    slug: c.slug,
    description: `${c.name}: ${c.nouns.slice(0, 3).join(', ').toLowerCase()} and more.`,
    product_count: 0,
    created_at: iso(WORLD_NOW - 400 * 86400000),
    updated_at: iso(WORLD_NOW - 400 * 86400000),
  }))

  // products
  const products: Row[] = []
  const skus = new Set<string>()
  for (let i = 1; i <= 2000; i++) {
    const ci = r.int(0, PRODUCT_CATEGORIES.length - 1)
    const cat = PRODUCT_CATEGORIES[ci]
    const brand = r.pick(cat.brands)
    const name = `${brand} ${r.pick(cat.adjectives)} ${r.pick(cat.nouns)}`
    let sku = `${cat.slug.slice(0, 3).toUpperCase()}-${r.code(6)}`
    while (skus.has(sku)) sku = `${cat.slug.slice(0, 3).toUpperCase()}-${r.code(6)}`
    skus.add(sku)
    const price = money(r.float(cat.priceLo, cat.priceHi))
    const onSale = r.chance(0.18)
    const created = pastMs(r, 400, 30)
    const status = r.weighted([['active', 88], ['draft', 5], ['archived', 7]] as const)
    products.push({
      id: i,
      sku,
      name: `${name}${r.chance(0.5) ? ' ' + r.pick(COLORS) : ''}`,
      slug: slug(`${name}-${sku}`),
      description: `${name} by ${brand}. ${r.pick(REVIEW_LINES)}`,
      category_id: ci + 1,
      brand,
      price,
      compare_at_price: onSale ? money(price * r.float(1.1, 1.6)) : null,
      currency: 'USD',
      color: r.pick(COLORS),
      weight_g: r.int(80, 12000),
      tags: JSON.stringify(r.some(cat.tags, r.int(1, 3))),
      in_stock: r.chance(0.85) ? 1 : 0,
      rating: 0,
      review_count: 0,
      status,
      created_at: iso(created),
      updated_at: iso(later(created, r, 0, 60 * 24 * 20)),
    })
    ;(categories[ci].product_count as number)++
  }

  // customers
  const customers: Row[] = []
  for (let i = 1; i <= 800; i++) {
    const p = person(r)
    const created = pastMs(r, 700, 10)
    customers.push({
      id: i,
      name: p.name,
      email: p.email,
      phone: p.phone,
      company: r.chance(0.3) ? company(r) : null,
      address: JSON.stringify(address(r)),
      tier: r.weighted([['standard', 60], ['silver', 22], ['gold', 13], ['platinum', 5]] as const),
      marketing_opt_in: r.chance(0.55) ? 1 : 0,
      orders_count: 0,
      total_spent: 0,
      notes: r.chance(0.1) ? r.pick(['Prefers email.', 'Wholesale account.', 'Ships to a PO box.', 'VIP — call before shipping.']) : null,
      created_at: iso(created),
      updated_at: iso(created),
    })
  }

  // orders + items
  const orders: Row[] = []
  const items: Row[] = []
  let itemId = 1
  const activeProducts = products.filter((p) => p.status === 'active')
  for (let i = 1; i <= 3000; i++) {
    const customer = customers[r.int(0, customers.length - 1)]
    const placed = pastMs(r, 365, 0)
    const n = r.weighted([[1, 40], [2, 30], [3, 17], [4, 8], [5, 5]] as const)
    let subtotal = 0
    const chosen = r.some(activeProducts, n)
    for (const p of chosen) {
      const qty = r.weighted([[1, 70], [2, 20], [3, 7], [4, 3]] as const)
      const unit = p.price as number
      const line = money(unit * qty)
      subtotal = money(subtotal + line)
      items.push({
        id: itemId++,
        order_id: i,
        product_id: p.id,
        sku: p.sku,
        name: p.name,
        quantity: qty,
        unit_price: unit,
        line_total: line,
        created_at: iso(placed),
        updated_at: iso(placed),
      })
    }
    const shippingMethod = r.weighted([['standard', 60], ['express', 25], ['overnight', 8], ['pickup', 7]] as const)
    const shipping = shippingMethod === 'pickup' ? 0 : shippingMethod === 'standard' ? 5.99 : shippingMethod === 'express' ? 14.99 : 29.99
    const discount = r.chance(0.15) ? money(subtotal * r.float(0.05, 0.2)) : 0
    const tax = money((subtotal - discount) * 0.07)
    const total = money(subtotal - discount + shipping + tax)
    const ageDays = (WORLD_NOW - placed) / 86400000
    let status: string
    if (ageDays < 1) status = r.weighted([['pending', 50], ['paid', 50]] as const)
    else if (ageDays < 3) status = r.weighted([['paid', 50], ['shipped', 45], ['cancelled', 5]] as const)
    else if (ageDays < 10) status = r.weighted([['shipped', 35], ['delivered', 60], ['cancelled', 5]] as const)
    else status = r.weighted([['delivered', 90], ['cancelled', 6], ['refunded', 4]] as const)
    const paidAt = status === 'pending' ? null : later(placed, r, 1, 120)
    const shippedAt = ['shipped', 'delivered'].includes(status) ? later(paidAt!, r, 60 * 4, 60 * 48) : null
    const deliveredAt = status === 'delivered' ? later(shippedAt!, r, 60 * 24, 60 * 24 * 6) : null
    const updated = deliveredAt ?? shippedAt ?? paidAt ?? placed
    orders.push({
      id: i,
      number: `SH-${100000 + i}`,
      customer_id: customer.id,
      status,
      subtotal,
      shipping,
      tax,
      discount,
      total,
      currency: 'USD',
      payment_method: r.weighted([['card', 70], ['paypal', 18], ['bank_transfer', 7], ['cash_on_delivery', 5]] as const),
      shipping_address: customer.address,
      shipping_method: shippingMethod,
      tracking_number: shippedAt ? `1Z${r.code(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')}` : null,
      placed_at: iso(placed),
      paid_at: paidAt ? iso(paidAt) : null,
      shipped_at: shippedAt ? iso(shippedAt) : null,
      delivered_at: deliveredAt ? iso(deliveredAt) : null,
      notes: r.chance(0.08) ? r.pick(['Leave at the door.', 'Gift — no receipt.', 'Call on arrival.', 'Fragile.']) : null,
      created_at: iso(placed),
      updated_at: iso(updated),
    })
    if (status !== 'cancelled' && status !== 'refunded') {
      ;(customer.orders_count as number)++
      customer.total_spent = money((customer.total_spent as number) + total)
    }
  }

  // reviews
  const reviews: Row[] = []
  const sums = new Map<number, { n: number; s: number }>()
  for (let i = 1; i <= 2500; i++) {
    const p = products[r.int(0, products.length - 1)]
    const c = customers[r.int(0, customers.length - 1)]
    const rating = r.weighted([[5, 42], [4, 30], [3, 14], [2, 8], [1, 6]] as const)
    const created = pastMs(r, 300, 0)
    reviews.push({
      id: i,
      product_id: p.id,
      customer_id: c.id,
      rating,
      title: r.pick(REVIEW_TITLES),
      body: sentences(r, REVIEW_LINES, r.int(1, 3)),
      verified_purchase: r.chance(0.7) ? 1 : 0,
      helpful_votes: r.weighted([[0, 50], [r.int(1, 5), 35], [r.int(6, 40), 15]] as const),
      created_at: iso(created),
      updated_at: iso(created),
    })
    const s = sums.get(p.id as number) ?? { n: 0, s: 0 }
    s.n++
    s.s += rating
    sums.set(p.id as number, s)
  }
  for (const p of products) {
    const s = sums.get(p.id as number)
    if (s) {
      p.rating = Math.round((s.s / s.n) * 10) / 10
      p.review_count = s.n
    } else {
      p.rating = null
      p.review_count = 0
    }
  }

  // warehouses + inventory
  const whCities = [CITIES.find((c) => c.airport === 'MIA')!, CITIES.find((c) => c.airport === 'AMS')!, CITIES.find((c) => c.airport === 'SIN')!]
  const warehouses: Row[] = whCities.map((c, i) => ({
    id: i + 1,
    code: c.airport,
    name: `${c.city} Fulfillment Center`,
    address: JSON.stringify(address(r, c)),
    timezone: c.tz,
    created_at: iso(WORLD_NOW - 500 * 86400000),
    updated_at: iso(WORLD_NOW - 500 * 86400000),
  }))
  const inventory: Row[] = []
  let invId = 1
  for (const p of products) {
    for (const w of warehouses) {
      const onHand = (p.in_stock as number) ? r.weighted([[r.int(0, 5), 15], [r.int(6, 60), 55], [r.int(61, 400), 30]] as const) : 0
      const counted = pastMs(r, 45, 0)
      inventory.push({
        id: invId++,
        product_id: p.id,
        warehouse_id: w.id,
        on_hand: onHand,
        reserved: onHand > 0 ? r.int(0, Math.min(onHand, 8)) : 0,
        reorder_point: r.pick([5, 10, 20, 50]),
        bin: `${r.code(1, 'ABCDEFGH')}-${r.int(1, 40)}-${r.int(1, 6)}`,
        counted_at: iso(counted),
        created_at: iso(counted),
        updated_at: iso(counted),
      })
    }
  }

  // carts
  const carts: Row[] = []
  for (let i = 1; i <= 200; i++) {
    const anon = r.chance(0.3)
    const n = r.int(1, 4)
    const chosen = r.some(activeProducts, n)
    const cartItems = chosen.map((p) => ({ product_id: p.id, sku: p.sku, name: p.name, quantity: r.int(1, 3), unit_price: p.price }))
    const subtotal = money(cartItems.reduce((s, it) => s + (it.unit_price as number) * it.quantity, 0))
    const last = pastMs(r, 20, 0)
    const status = (WORLD_NOW - last) / 86400000 > 7 ? 'abandoned' : r.weighted([['open', 85], ['converted', 15]] as const)
    carts.push({
      id: i,
      customer_id: anon ? null : customers[r.int(0, customers.length - 1)].id,
      session_id: anon ? `sess_${r.token(16)}` : null,
      status,
      items: JSON.stringify(cartItems),
      item_count: cartItems.reduce((s, it) => s + it.quantity, 0),
      subtotal,
      coupon: r.chance(0.2) ? r.pick(['WELCOME10', 'SPRING15', 'FREESHIP']) : null,
      last_activity_at: iso(last),
      created_at: iso(last - r.int(1, 300) * 60000),
      updated_at: iso(last),
    })
  }

  out.categories = categories
  out.products = products
  out.customers = customers
  out.orders = orders
  out.order_items = items
  out.reviews = reviews
  out.warehouses = warehouses
  out.inventory = inventory
  out.carts = carts
  return out
}
