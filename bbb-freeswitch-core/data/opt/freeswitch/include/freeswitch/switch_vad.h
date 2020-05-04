/*
 * FreeSWITCH Modular Media Switching Software Library / Soft-Switch Application
 * Copyright (C) 2018, Anthony Minessale II <anthm@freeswitch.org>
 *
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is FreeSWITCH Modular Media Switching Software Library / Soft-Switch Application
 *
 * The Initial Developer of the Original Code is
 * Anthony Minessale II <anthm@freeswitch.org>
 * Portions created by the Initial Developer are Copyright (C)
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Seven Du <dujinfang@gmail.com>
 *
 *
 * switch_vad.h VAD code with optional libfvad
 *
 */
/*!
  \defgroup vad1 VAD code with optional libfvad
  \ingroup core1
  \{
*/
#ifndef FREESWITCH_VAD_H
#define FREESWITCH_VAD_H

SWITCH_BEGIN_EXTERN_C

SWITCH_DECLARE(switch_vad_t *) switch_vad_init(int sample_rate, int channels);

/*
 * Valid modes are -1 ("disable fvad, using native"), 0 ("quality"), 1 ("low bitrate"), 2 ("aggressive"), and 3 * ("very aggressive").
 * The default mode is -1.
*/

SWITCH_DECLARE(int) switch_vad_set_mode(switch_vad_t *vad, int mode);
SWITCH_DECLARE(void) switch_vad_set_param(switch_vad_t *vad, const char *key, int val);
SWITCH_DECLARE(switch_vad_state_t) switch_vad_process(switch_vad_t *vad, int16_t *data, unsigned int samples);
SWITCH_DECLARE(switch_vad_state_t) switch_vad_get_state(switch_vad_t *vad);
SWITCH_DECLARE(void) switch_vad_reset(switch_vad_t *vad);
SWITCH_DECLARE(void) switch_vad_destroy(switch_vad_t **vad);

SWITCH_DECLARE(const char *) switch_vad_state2str(switch_vad_state_t state);

SWITCH_END_EXTERN_C
#endif
/* For Emacs:
 * Local Variables:
 * mode:c
 * indent-tabs-mode:t
 * tab-width:4
 * c-basic-offset:4
 * End:
 * For VIM:
 * vim:set softtabstop=4 shiftwidth=4 tabstop=4 noet:
 */
