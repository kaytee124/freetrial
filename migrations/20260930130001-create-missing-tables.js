'use strict';

/**
 * Creates application tables that are not already present.
 * Existing tables are left unchanged.
 */

const ADDON_SEED = [
  { name: 'SINGLETS', category: 'Undergarments', sort_order: 10 },
  { name: 'BOXERS', category: 'Undergarments', sort_order: 20 },
  { name: 'UNDERWEAR', category: 'Undergarments', sort_order: 30 },
  { name: 'INNER', category: 'Undergarments', sort_order: 40 },
  { name: 'VEST', category: 'Undergarments', sort_order: 50 },
  { name: 'BLANKETS', category: 'Bedding extras', sort_order: 60 },
  { name: 'PILLOWCASE', category: 'Bedding extras', sort_order: 70 },
  { name: 'SMOCK', category: 'Garments', sort_order: 80 },
  { name: 'JALABIA', category: 'Garments', sort_order: 90 },
  { name: 'NIGHTWEAR', category: 'Garments', sort_order: 100 },
  { name: 'KAFTAN', category: 'Garments', sort_order: 110 },
  { name: 'KENTE CLOTH', category: 'Specialty', sort_order: 120 },
  { name: 'KENTE SLIT AND KABA', category: 'Specialty', sort_order: 130 },
  { name: 'SLIT & KABA', category: 'Specialty', sort_order: 140 },
  { name: 'SLIT', category: 'Specialty', sort_order: 150 },
  { name: 'KABA', category: 'Specialty', sort_order: 160 },
  { name: 'KENTE DRESS', category: 'Specialty', sort_order: 170 },
  { name: 'JACKET', category: 'Specialty', sort_order: 180 },
  { name: 'BEADS DRESS', category: 'Specialty', sort_order: 190 },
  { name: 'SUIT UD', category: 'Specialty', sort_order: 200 },
  { name: 'SUIT TOP', category: 'Specialty', sort_order: 210 },
  { name: 'SKIRT & TOP', category: 'Specialty', sort_order: 220 },
  { name: 'LACE DRESS', category: 'Specialty', sort_order: 230 },
  { name: "MEN'S CLOTH", category: 'Specialty', sort_order: 240 },
  { name: 'SHORTS', category: 'Specialty', sort_order: 250 },
  { name: 'SKIRTS', category: 'Specialty', sort_order: 260 },
  { name: 'FACE TOWEL', category: 'Specialty', sort_order: 270 },
  { name: 'HANDKERCHIEF', category: 'Specialty', sort_order: 280 },
  { name: 'GRADUATION GOWN', category: 'Specialty', sort_order: 290 },
];

function existingTableNames(tables) {
  return new Set(
    tables.map((t) => String(typeof t === 'string' ? t : t.tableName || t.name || '').toLowerCase())
  );
}

function nowDefault(Sequelize) {
  return { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') };
}

function userFk(Sequelize, onDelete) {
  return {
    type: Sequelize.BIGINT,
    allowNull: true,
    references: { model: 'users', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete,
  };
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const present = existingTableNames(await queryInterface.showAllTables());
    const created = [];

    async function ensure(name, definition, afterCreate) {
      if (present.has(name)) return;
      await queryInterface.createTable(name, definition);
      present.add(name);
      created.push(name);
      if (afterCreate) await afterCreate();
    }

    await ensure('users', {
      id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
      username: { type: Sequelize.STRING(150), allowNull: false, unique: true },
      password_hash: { type: Sequelize.STRING(128), allowNull: false },
      first_name: { type: Sequelize.STRING(150), allowNull: false, defaultValue: '' },
      last_name: { type: Sequelize.STRING(150), allowNull: false, defaultValue: '' },
      phone_number: { type: Sequelize.STRING(20), allowNull: true },
      role: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'client' },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      is_staff: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      is_superuser: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      last_login: { type: Sequelize.DATE, allowNull: true },
      date_joined: nowDefault(Sequelize),
      updated_at: nowDefault(Sequelize),
      updated_by: { type: Sequelize.BIGINT, allowNull: true },
    });

    await ensure('customers', {
      id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
      user_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        unique: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      phone_number: { type: Sequelize.STRING(20), allowNull: false, unique: true },
      whatsapp_number: { type: Sequelize.STRING(20), allowNull: false, unique: true },
      phone_needs_correction: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      address: { type: Sequelize.TEXT, allowNull: false },
      preferred_contact_method: { type: Sequelize.STRING(20), allowNull: false },
      notes: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      total_orders: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      total_spent: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      last_order_date: { type: Sequelize.DATE, allowNull: true },
      created_by: userFk(Sequelize, 'SET NULL'),
      created_at: nowDefault(Sequelize),
      updated_at: nowDefault(Sequelize),
      updated_by: userFk(Sequelize, 'SET NULL'),
    });

    await ensure('services', {
      id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING(255), allowNull: false, unique: true },
      description: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      price: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      unit: { type: Sequelize.STRING(255), allowNull: false, defaultValue: '' },
      category: { type: Sequelize.STRING(255), allowNull: false, defaultValue: '' },
      estimated_days: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_by: userFk(Sequelize, 'SET NULL'),
      updated_by: userFk(Sequelize, 'SET NULL'),
      created_at: nowDefault(Sequelize),
      updated_at: nowDefault(Sequelize),
    });

    await ensure('orders', {
      id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
      order_number: { type: Sequelize.STRING(50), allowNull: false, unique: true },
      customer_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: { model: 'customers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      assigned_to: userFk(Sequelize, 'SET NULL'),
      order_status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
      payment_status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
      total_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      amount_paid: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      discount_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      delivery_notes: { type: Sequelize.TEXT, allowNull: true },
      special_instructions: { type: Sequelize.TEXT, allowNull: true },
      pickup_date: { type: Sequelize.DATEONLY, allowNull: true },
      delivery_date: { type: Sequelize.DATEONLY, allowNull: true },
      delivery_time: { type: Sequelize.TIME, allowNull: true },
      estimated_completion_date: { type: Sequelize.DATEONLY, allowNull: true },
      completed_at: { type: Sequelize.DATE, allowNull: true },
      picked_up: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      picked_up_at: { type: Sequelize.DATE, allowNull: true },
      reminder_24h_sent_at: { type: Sequelize.DATE, allowNull: true },
      reminder_1h_sent_at: { type: Sequelize.DATE, allowNull: true },
      created_by: userFk(Sequelize, 'SET NULL'),
      created_at: nowDefault(Sequelize),
      updated_at: nowDefault(Sequelize),
      updated_by: userFk(Sequelize, 'SET NULL'),
    });

    await ensure('order_items', {
      id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
      order_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      service_id: {
        type: Sequelize.BIGINT,
        allowNull: true,
        references: { model: 'services', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      item_name: { type: Sequelize.STRING(100), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      dirty_quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      clean_quantity: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      unit_price: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      subtotal: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      notes: { type: Sequelize.TEXT, allowNull: true },
      created_at: nowDefault(Sequelize),
      updated_at: nowDefault(Sequelize),
    });

    await ensure(
      'order_services',
      {
        id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
        order_id: {
          type: Sequelize.BIGINT,
          allowNull: false,
          references: { model: 'orders', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        service_id: {
          type: Sequelize.BIGINT,
          allowNull: false,
          references: { model: 'services', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'RESTRICT',
        },
      },
      async () => {
        await queryInterface.addConstraint('order_services', {
          fields: ['order_id', 'service_id'],
          type: 'unique',
          name: 'order_services_order_id_service_id_unique',
        });
      }
    );

    await ensure('payments', {
      id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
      order_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      externalref: { type: Sequelize.STRING(100), allowNull: false, unique: true },
      amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
      payment_method: { type: Sequelize.STRING(20), allowNull: false },
      provider: { type: Sequelize.STRING(20), allowNull: true },
      moolre_reference: { type: Sequelize.STRING(100), allowNull: true },
      transaction_id: { type: Sequelize.STRING(100), allowNull: true },
      thirdparty_ref: { type: Sequelize.STRING(100), allowNull: true },
      payer: { type: Sequelize.STRING(255), allowNull: true },
      value: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      payer_phone: { type: Sequelize.STRING(20), allowNull: true },
      currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'GHS' },
      fees: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      metadata: { type: Sequelize.JSON, allowNull: true },
      paid_at: { type: Sequelize.DATE, allowNull: true },
      last_checked_at: { type: Sequelize.DATE, allowNull: true },
      created_by: userFk(Sequelize, 'SET NULL'),
      created_at: nowDefault(Sequelize),
      updated_at: nowDefault(Sequelize),
      updated_by: userFk(Sequelize, 'SET NULL'),
    });

    await ensure('refresh_tokens', {
      id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
      user_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      token_jti: { type: Sequelize.STRING(64), allowNull: false, unique: true },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      blacklisted_at: { type: Sequelize.DATE, allowNull: true },
      created_at: nowDefault(Sequelize),
    });

    await ensure('order_status_history', {
      id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
      order_id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        references: { model: 'orders', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      old_status: { type: Sequelize.STRING(20), allowNull: true },
      new_status: { type: Sequelize.STRING(20), allowNull: false },
      changed_by: userFk(Sequelize, 'SET NULL'),
      changed_at: nowDefault(Sequelize),
    });

    await ensure('ussd_sessions', {
      session_id: { type: Sequelize.STRING(100), primaryKey: true },
      step: { type: Sequelize.STRING(30), allowNull: false },
      data: { type: Sequelize.JSON, allowNull: false },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: nowDefault(Sequelize),
    });

    await ensure(
      'welcome_login_tokens',
      {
        id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
        user_id: {
          type: Sequelize.BIGINT,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
        },
        token_hash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
        expires_at: { type: Sequelize.DATE, allowNull: false },
        used_at: { type: Sequelize.DATE, allowNull: true },
        created_at: nowDefault(Sequelize),
      },
      async () => {
        await queryInterface.addIndex('welcome_login_tokens', ['user_id'], {
          name: 'welcome_login_tokens_user_id',
        });
        await queryInterface.addIndex('welcome_login_tokens', ['expires_at'], {
          name: 'welcome_login_tokens_expires_at',
        });
      }
    );

    await ensure(
      'sms_outbox',
      {
        id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
        recipient: { type: Sequelize.STRING(20), allowNull: false },
        message: { type: Sequelize.TEXT, allowNull: false },
        ref: { type: Sequelize.STRING(100), allowNull: true },
        purpose: { type: Sequelize.STRING(50), allowNull: false },
        related_type: { type: Sequelize.STRING(20), allowNull: true },
        related_id: { type: Sequelize.BIGINT, allowNull: true },
        status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
        attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        last_error: { type: Sequelize.TEXT, allowNull: true },
        last_attempt_at: { type: Sequelize.DATE, allowNull: true },
        created_at: nowDefault(Sequelize),
        sent_at: { type: Sequelize.DATE, allowNull: true },
      },
      async () => {
        await queryInterface.addIndex('sms_outbox', ['status'], { name: 'sms_outbox_status_idx' });
      }
    );

    await ensure(
      'addon_catalog_items',
      {
        id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
        name: { type: Sequelize.STRING(100), allowNull: false, unique: true },
        category: { type: Sequelize.STRING(50), allowNull: true },
        is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        sort_order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        created_by: userFk(Sequelize, 'SET NULL'),
        updated_by: userFk(Sequelize, 'SET NULL'),
        created_at: nowDefault(Sequelize),
        updated_at: nowDefault(Sequelize),
      },
      async () => {
        const now = new Date();
        await queryInterface.bulkInsert(
          'addon_catalog_items',
          ADDON_SEED.map((row) => ({
            ...row,
            is_active: true,
            created_by: null,
            updated_by: null,
            created_at: now,
            updated_at: now,
          }))
        );
      }
    );

    if (created.length) {
      console.log(JSON.stringify({ event: 'created_missing_tables', tables: created }));
    }
  },

  async down() {
    // Do not drop tables that may already hold production data.
  },
};
