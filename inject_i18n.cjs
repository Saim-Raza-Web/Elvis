const fs = require('fs');
const path = require('path');

const i18nPath = path.join(__dirname, 'src/app/i18n.ts');
let content = fs.readFileSync(i18nPath, 'utf8');

const newCommonKeysEn = `      // --- Order Form Missing Keys ---
      addLine: "Add Line", sku: "SKU", productName: "Product Name", qty: "Qty",
      unitPrice: "Unit Price", lineTotal: "Line Total", sKU001: "SKU-001",
      productDescription: "Product description", warehouseDeliveryAddress: "Warehouse Delivery Address",
      customerDeliveryAddress: "Customer Delivery Address", shipmentInfo: "Shipment Information",
      numberOfPallets: "Number of Pallets", totalShipmentWeight: "Total Shipment Weight",
      deliveryTerms: "Delivery Terms", selectDeliveryTerms: "Select Delivery Terms",
      agreedDeliveryDate: "Agreed Delivery Date", shippingInformationOptional: "Shipping Information (Optional)",
      trackingNumber: "Tracking Number", packageWeight: "Package Weight",
      packageDimensions: "Package Dimensions", channel: "Channel", web: "Web", aPI: "API", mobile: "Mobile",
      eCommerceStoreOptional: "eCommerce Store (Optional)", fulfillmentWarehouse: "Fulfillment Warehouse", mIA: "MIA",
      notesSpecialInstructions: "Notes / Special Instructions", handleWithCareRequiresColdChain: "Handle with care, requires cold chain…",
      b2cEcommerce: "B2C — E-commerce", b2bWholesale: "B2B — Wholesale / Pallets",
      customerName: "Customer Name", johnDoeAcmeLtd: "John Doe / Acme Ltd", ordersCompanyCom: "orders@company.com",
      poReference: "PO Reference", pO2025001: "PO-2025-001", companyInfo: "Company Info", companyName: "Company Name",
      acmeCorporationSL: "Acme Corporation S.L.", vatNumber: "VAT Number", b12345678: "B-12345678", contactPerson: "Contact Person",
      mariaGarcA: "Maria Garcia", contactPhone: "Contact Phone", street: "Street", calleMayor: "Calle Mayor",
      number: "Number", postcode: "Postcode", city: "City", madrid: "Madrid", region: "Region / State", comunidadDeMadrid: "Comunidad de Madrid",
      country: "Country", spain: "Spain", error: "Error", operationSuccess: "Success", viewEdit: "View / Edit",
      deleteOrder: "Delete Order", subtotal: "Subtotal",`;

const newOrdersKeysEn = `      productLines: "Product Lines",`;

const newCommonKeysEs = `      // --- Order Form Missing Keys ---
      addLine: "Añadir Línea", sku: "SKU", productName: "Nombre del Producto", qty: "Cant",
      unitPrice: "Precio Unitario", lineTotal: "Total Línea", sKU001: "SKU-001",
      productDescription: "Descripción del producto", warehouseDeliveryAddress: "Dirección de Entrega del Almacén",
      customerDeliveryAddress: "Dirección de Entrega del Cliente", shipmentInfo: "Información de Envío",
      numberOfPallets: "Número de Palets", totalShipmentWeight: "Peso Total del Envío",
      deliveryTerms: "Términos de Entrega", selectDeliveryTerms: "Seleccionar Términos de Entrega",
      agreedDeliveryDate: "Fecha de Entrega Acordada", shippingInformationOptional: "Información de Envío (Opcional)",
      trackingNumber: "Número de Seguimiento", packageWeight: "Peso del Paquete",
      packageDimensions: "Dimensiones del Paquete", channel: "Canal", web: "Web", aPI: "API", mobile: "Móvil",
      eCommerceStoreOptional: "Tienda eCommerce (Opcional)", fulfillmentWarehouse: "Almacén de Cumplimiento", mIA: "MIA",
      notesSpecialInstructions: "Notas / Instrucciones Especiales", handleWithCareRequiresColdChain: "Manejar con cuidado, requiere cadena de frío…",
      b2cEcommerce: "B2C — E-commerce", b2bWholesale: "B2B — Mayorista / Palets",
      customerName: "Nombre del Cliente", johnDoeAcmeLtd: "Juan Pérez / Acme Ltd", ordersCompanyCom: "pedidos@empresa.com",
      poReference: "Referencia OC", pO2025001: "OC-2025-001", companyInfo: "Info. de la Empresa", companyName: "Nombre de la Empresa",
      acmeCorporationSL: "Acme Corporation S.L.", vatNumber: "NIF/CIF", b12345678: "B-12345678", contactPerson: "Persona de Contacto",
      mariaGarcA: "Maria Garcia", contactPhone: "Teléfono de Contacto", street: "Calle", calleMayor: "Calle Mayor",
      number: "Número", postcode: "Código Postal", city: "Ciudad", madrid: "Madrid", region: "Región / Estado", comunidadDeMadrid: "Comunidad de Madrid",
      country: "País", spain: "España", error: "Error", operationSuccess: "Éxito", viewEdit: "Ver / Editar",
      deleteOrder: "Eliminar Pedido", subtotal: "Subtotal",`;

const newOrdersKeysEs = `      productLines: "Líneas de Producto",`;

const langs = ['en', 'es', 'fr', 'it'];

langs.forEach(lang => {
  const commonRegex = new RegExp('(' + lang + ': \\{[\\\\s\\\\S]*?common: \\{)', 'g');
  const commonReplacer = lang === 'en' ? newCommonKeysEn : newCommonKeysEs;
  content = content.replace(commonRegex, '$1\\n' + commonReplacer);

  const ordersRegex = new RegExp('(' + lang + ': \\{[\\\\s\\\\S]*?orders: \\{)', 'g');
  const ordersReplacer = lang === 'en' ? newOrdersKeysEn : newOrdersKeysEs;
  content = content.replace(ordersRegex, '$1\\n' + ordersReplacer);
});

fs.writeFileSync(i18nPath, content, 'utf8');
console.log('Successfully injected missing keys into i18n.ts');
