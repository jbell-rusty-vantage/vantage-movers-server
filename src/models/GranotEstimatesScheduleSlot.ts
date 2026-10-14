import mongoose, { Schema } from 'mongoose';

const windowSchema = new Schema({from:{type:String,required:true},to:{type:String,required:true}},{_id:false});
/** Immutable scope is stored before child1. Recovery must not infer scope from whichever children exist. */
const schema = new Schema({
  _id:{type:String,required:true},
  lane:{type:String,enum:['all','pool_refresh','pool_discovery'],required:true},
  date_window:{type:windowSchema,required:true},
  windows:{type:[windowSchema],required:true},
  after_all_slot:{type:String,default:null},
  after_all_windows:{type:Number,default:null},
  initiator:{type:Schema.Types.Mixed,required:true},
  dispatched:{type:Boolean,required:true,default:false},
  also_pool_refresh:{type:Boolean,required:true,default:false},
  pool_manifest_created:{type:Boolean,required:true,default:false},
  purge_at:{type:Date,required:true},
},{collection:'granot_estimates_schedule_slots',timestamps:true,versionKey:false});
schema.index({purge_at:1},{expireAfterSeconds:0,name:'granot_estimates_schedule_retention'});
export const GranotEstimatesScheduleSlot = mongoose.models.GranotEstimatesScheduleSlot ?? mongoose.model('GranotEstimatesScheduleSlot',schema);
