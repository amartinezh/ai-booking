import { Module, forwardRef } from '@nestjs/common';
import { WaitlistService } from './waitlist.service';
import { ChatbotModule } from '../chatbot/chatbot.module';

@Module({
    imports: [forwardRef(() => ChatbotModule)],
    providers: [WaitlistService],
    exports: [WaitlistService],
})
export class WaitlistModule { }