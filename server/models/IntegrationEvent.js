import mongoose from 'mongoose';

const integrationEventSchema = new mongoose.Schema({
  company: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Company', 
    required: true, 
    index: true 
  },
  connectedStore: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'ConnectedStore', 
    required: true, 
    index: true 
  },
  provider: { 
    type: String, 
    required: true 
  },
  eventId: { 
    type: String, 
    required: true,
    index: true 
  },
  topic: { 
    type: String, 
    required: true 
  },
  status: { 
    type: String, 
    enum: ['received', 'processed', 'failed', 'ignored'], 
    default: 'received',
    index: true 
  },
  payload: { 
    type: mongoose.Schema.Types.Mixed 
  },
  error: { 
    type: String, 
    default: '' 
  }
}, { 
  timestamps: true 
});

// Idempotency: Prevent duplicate processing of the same event ID per store
integrationEventSchema.index({ connectedStore: 1, eventId: 1 }, { unique: true });

export default mongoose.model('IntegrationEvent', integrationEventSchema);
