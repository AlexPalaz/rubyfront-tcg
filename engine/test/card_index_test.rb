# frozen_string_literal: true

require "json"
require "minitest/autorun"
require_relative "../lib/rubyfront/card_index"

# L'anagrafe letta dai dati veri del repo: se questi test si rompono, o è
# cambiato lo schema delle carte o è cambiato il posto dei dati.
class CardIndexTest < Minitest::Test
  DATA_DIR = File.expand_path("../../data", __dir__)

  def setup
    @index = Rubyfront::CardIndex.load(DATA_DIR)
  end

  # Il debito dichiarato della regola d'oro (§1.1): i trigger delle carte
  # che NESSUNA forma certificata legge ancora. Ogni carta collegata toglie
  # la sua voce; un trigger che sparisce da qui senza una forma nuova, o che
  # vi compare, è una forma rotta o un dato cambiato di nascosto — e il test
  # lo dice forte, prima che l'effetto svanisca in silenzio dal tavolo.
  DEBITO = [
  ].freeze

  def test_ogni_trigger_ha_una_forma_o_sta_nel_debito_dichiarato
    ignoti = Rubyfront::CardIndex.unknown_triggers(DATA_DIR)
    rotti = ignoti - DEBITO
    assert_empty rotti, "trigger che nessuna forma legge più (forma rotta o dato cambiato): #{rotti.join(", ")}"
    saldati = DEBITO - ignoti
    assert_empty saldati, "trigger ormai riconosciuti: toglierli dal DEBITO: #{saldati.join(", ")}"
  end

  def test_i_trigger_certificati_sono_riconosciuti
    scout = JSON.parse(File.read(File.join(DATA_DIR, "sets", "srbf-001", "cards", "rbf-026", "rbf-026.json")))
    trigger = scout["faces"].flat_map { |face| face["triggers"] }.find { |t| t["id"] == "scouting" }
    assert Rubyfront::CardIndex.recognized?(trigger)
    # Lo stesso trigger con lo scarto a 2 esce dalla forma: ignoto, non frainteso.
    altro = Marshal.load(Marshal.dump(trigger))
    altro["effect"]["details"]["thenDiscardCards"] = 2
    refute Rubyfront::CardIndex.recognized?(altro)
  end

  # §3.1 — ogni Rubyfront del set stampa i suoi PV, e l'anagrafe li legge.
  def test_ogni_rubyfront_ha_i_pv_stampati
    rubyfronts = @index.select { |_, card| card[:type] == "rubyfront" }
    refute_empty rubyfronts
    rubyfronts.each do |id, card|
      assert card[:health].is_a?(Integer) && card[:health].positive?, "il Rubyfront #{id} non ha PV stampati leggibili"
    end
  end

  def test_legge_il_set
    refute_empty @index, "nessuna carta trovata in #{DATA_DIR}"
  end

  def test_conosce_il_radunatore_con_slancio
    card = @index["RBF-009"]
    refute_nil card, "RBF-009 manca dall'anagrafe"
    assert_equal "entity", card[:type]
    assert_includes card[:keywords], "surge"
  end

  def test_ignora_i_file_di_testo_locale
    # I *.it.json e *.en.json non hanno "id" di carta o non rispettano il
    # nome della cartella: nessuna chiave dell'indice deve essere nil o vuota.
    assert @index.keys.all? { |id| id.is_a?(String) && !id.empty? }
  end

  def test_cartella_inesistente_da_indice_vuoto
    assert_empty Rubyfront::CardIndex.load("/posto/che/non/esiste")
  end

  # --- gli ascoltatori d'ingresso certificati (§8.2) ----------------------

  def test_la_guida_ascolta_gli_ingressi_degli_umani
    listeners = @index["RBF-003"][:enter_listeners]
    assert_equal 1, listeners.size
    assert_equal({ entering_race: "human", requires: { count: 3, race: "human" }, draw: 1 }, listeners.first)
    assert_equal [], @index["RBF-004"][:enter_listeners], "un on_attack non è un ascoltatore d'ingresso"
    assert_equal [], @index["RBF-007"][:enter_listeners], "un move_card all'ingresso non è la forma certificata"
  end

  def test_l_arciere_esilia_nell_abisso_e_lo_spostamento_in_ritiro_resta_leggibile
    # Dal 2026-09-04 l'Arciere esilia nell'Abisso «finché resta in campo»
    # (revisione del foglio del designer): dal 2026-09-06 è la forma
    # certificata dell'esilio condizionato all'ingresso.
    assert_equal [{ target: { type: "entity", controller: "opponent" }, to: "abisso", hold: true }], @index["RBF-007"][:enter_moves]
    forma = { "target" => { "cardType" => "entity", "controller" => "opponent", "zone" => "front", "owner" => "opponent", "min" => 1, "max" => 1 },
              "destination" => { "zone" => "retire" } }
    refute_nil Rubyfront::CardIndex.enter_moves([{ "triggers" => [{ "event" => "on_enter_field", "effect" => forma.merge("type" => "move_card") }] }]).first, "la forma resta leggibile, anche senza una carta che la porti"
    assert_equal [], @index["RBF-003"][:enter_moves], "un ascoltatore non è uno spostamento di chi entra"
    assert_equal [], @index["RBF-012"][:enter_moves], "dalla propria Zona di Ritiro al Fronte è un'altra forma"
  end

  def test_rhen_riporta_una_permanente_dalla_zona_di_ritiro
    # Solo «quando attacca» (decisione del designer, 2026-09-04): l'innesco
    # d'ingresso è stato tolto dalla carta.
    forma = [{ from: "ritiro", filter: { permanent: true }, to: "field" }]
    assert_equal forma, @index["RBF-012"][:attack_returns]
    assert_equal [], @index["RBF-012"][:enter_returns], "non più all'ingresso"
    assert_equal [], @index["RBF-012"][:attack_draws], "il ritorno riporta, non pesca"
  end

  def test_le_forme_quando_attacca_delle_carte_vere
    forme = ->(id) { @index[id][:attack_forms].map { |form| [form[:kind], form[:who], form[:face]] } }
    assert_equal [], forme.call("RBF-028"), "dal 2026-09-10 la Sentinella non ha forme d'attacco"
    assert_equal [["empower", "self", 0]], forme.call("RBF-029")
    assert_equal [["empower", "object", 0], ["look", "object", 0]], forme.call("RBF-034")
    assert_equal [["rearm", "ally", 0], ["look", "ally", 0]], forme.call("RBF-031")
    assert_equal [["heal", "self", 0]], forme.call("RBF-008")
    assert_equal [["return", "self", 0]], forme.call("RBF-010")
    assert_equal [], forme.call("RBF-011"), "dal 2026-09-05 la stappata si innesca entrando, non attaccando"
    assert_equal [["heal", "permanent", 0]], forme.call("RBF-022")
    assert_equal [["heal", "rubyfront", 0], ["heal", "rubyfront", 1]], forme.call("RBF-001")
    assert_equal [["empower", "self", 0]], forme.call("RBF-004"), "dal 2026-09-09 «se almeno 2 Umani attaccano» è il divieto di blocco di questo turno"
    assert_equal [], forme.call("RBF-005"), "dal 2026-09-08 non ha più inneschi d'attacco: è uno statico"
    # I dettagli che contano: dadi, soglie, destinazioni, seguiti.
    assert_equal({ die: 6, on_roll: [5, 6], count: 4, reveal_to: "hand", rest_to: "ritiro" }, @index["RBF-034"][:attack_forms][1].slice(:die, :on_roll, :count, :reveal_to, :rest_to))
    assert_equal({ once: true, count: 2, reveal_to: "ritiro", rest_to: "deck" }, @index["RBF-031"][:attack_forms][1].slice(:once, :count, :reveal_to, :rest_to))
    assert_equal({ amount: 2, die: 6, on_roll: [5, 6] }, @index["RBF-008"][:attack_forms][0].slice(:amount, :die, :on_roll))
    assert_equal [{ die: 20, on_roll: [15, 20] }], @index["RBF-011"][:enter_refreshes], "quando entra, col d20 stappa tutto"
    assert_equal({ gain_on: [1, 6], drain_on: [15, 20], once: true }, @index["RBF-022"][:attack_forms][0].slice(:gain_on, :drain_on, :once), "una volta per turno, dal 2026-09-10")
    assert_equal({ requires_attackers: { count: 2, race: "human" }, targets: "opposing_entity", restrict: "block" }, @index["RBF-004"][:attack_forms][0].slice(:requires_attackers, :targets, :restrict), "conta gli attaccanti di questo turno, non del precedente")
    assert_equal [0, 1], @index["RBF-001"][:attack_forms].map { |form| form[:then_draw] }, "solo il Nexus pesca"
  end

  # --- gli statici, le Materie e il flip di Eredità Perduta (§8.2, §7.2, §3.1) --

  def test_le_abilita_speciali_dei_rubyfront_veri
    oblivhal = @index["RBF-001"][:abilities]
    assert_equal %w[glade-call charge-order heir-step return-to-front], oblivhal.map { |a| a[:id] }, "dal 2026-09-08 il Nexus ha due abilità"
    assert_equal({ id: "glade-call", face: 0, timing: %w[preparazione fronte], cost: nil, gain: 3, fury: true,
                   form: { kind: "look", count: 3, reveal: { type: "entity", race: "human" } } }, oblivhal[0])
    assert_equal({ kind: "power", amount: 1, targets: "all", race: "human", attacking: true, armed: false }, oblivhal[1][:form])
    assert_equal 5, oblivhal[1][:cost]
    assert_equal({ kind: "discount", amount: 1, type: "entity", race: "human" }, oblivhal[2][:form])
    assert_equal [1, 1], oblivhal[2..3].map { |a| a[:face] }
    assert_equal({ kind: "summon", race: "human", grants: ["surge"], bonus: { amount: 1, race: "human" } }, oblivhal[3][:form],
                 "«metti sul tuo Fronte un Umano dalla mano senza costo, con Slancio; +1 alle prossime attaccanti» è la chiamata sul Fronte")
    assert_equal 7, oblivhal[3][:cost]
    assert_equal({ 0 => 13 }, @index["RBF-001"][:fury_at], "la Furia solo sulla faccia del Rubyfront, a 13")
    rhazmora = @index["RBF-023"][:abilities]
    assert_equal %w[swift-forge calibrated-strike deep-forge blade-chorus], rhazmora.map { |a| a[:id] }, "dal 2026-09-10 senza il riarmo"
    assert_equal({ kind: "discount", amount: 1, type: "object", race: nil }, rhazmora[0][:form])
    assert_equal %w[preparazione], rhazmora[0][:timing]
    assert_equal [nil, 3], [rhazmora[0][:cost], rhazmora[0][:gain]], "Forgia Rapida: +3 PV dal 2026-09-10"
    assert_equal({ kind: "power", amount: 2, targets: "one", race: nil, attacking: false, armed: true }, rhazmora[1][:form])
    assert_equal({ kind: "power", amount: 2, targets: "all", race: nil, attacking: false, armed: true }, rhazmora[3][:form])
    assert_equal 5, rhazmora[3][:cost], "Coro delle Lame: −5 PV, +2 dal 2026-09-10"
    assert_equal({ 0 => 12 }, @index["RBF-023"][:fury_at])
    assert_equal [], @index["RBF-002"][:abilities], "un'Entità non ha abilità speciali"
  end

  def test_gli_statici_di_potenza_delle_carte_vere
    assert_equal [{ kind: "self_power", amount: 1, while_attacking: true, requires_other: { type: "entity", race: "human" } }], @index["RBF-002"][:static_forms]
    assert_equal [{ kind: "self_power", amount: 1, per_other: { type: "entity", race: "human" } }], @index["RBF-010"][:static_forms]
    assert_equal [{ kind: "bearer_power", amount: 1 }], @index["RBF-013"][:static_forms], "il +1 dell'Oggetto; la Stasi sta nelle concessioni"
    assert_equal [{ kind: "bearer_power", amount: 1, per: { type: "entity", race: "human" }, multi_block: true }], @index["RBF-014"][:static_forms]
    assert_equal [{ kind: "self_counter", amount: 1, per_object: true }], @index["RBF-028"][:static_forms], "dal 2026-09-10 il Contrattacco per Oggetto"
    assert_nil @index.values.find { |c| Array(c[:static_forms]).any? { |f| f[:kind] == "flux_toll" } }, "la tassa di Flusso resta certificata, oggi senza carte"
    assert_equal [{ kind: "never_taps" }], @index["RBF-011"][:static_forms], "«questa Entità non si tappa mai»"
    assert_equal [{ kind: "never_taps" }], @index["RBF-005"][:static_forms], "dal 2026-09-08 anche il 2 Flussi non si tappa attaccando"
    assert_equal [{ kind: "others_armed_power", amount: 1 }], @index["RBF-031"][:static_forms], "«+1 alle altre armate» certificato dal 2026-09-10"
    # Dal 2026-09-10: «se ha un Oggetto assegnato, +1» e gli Oggetti «mentre assegnato» senza durata esplicita.
    assert_equal [{ kind: "self_power", amount: 1, while_armed: true }], @index["RBF-024"][:static_forms]
    assert_equal [{ kind: "bearer_power", amount: 1 }], @index["RBF-032"][:static_forms]
    assert_equal [{ kind: "bearer_power", amount: 1 }, { kind: "bearer_counter", amount: 1 }], @index["RBF-033"][:static_forms], "+1 Potenza e Contrattacco +1 al portatore"
    assert_equal [{ kind: "bearer_power", amount: 2 }], @index["RBF-035"][:static_forms], "il ritorno in Ritiro resta nel debito"
  end

  # Dal 2026-09-10: il disarmo con riarmo all'ingresso e il ritorno vincolato.
  def test_disarmo_riarmo_e_ritorno_vincolato
    assert_equal [{ to: "ritiro" }], @index["RBF-046"][:enter_disarms]
    assert_equal [{ any: true }], @index["RBF-046"][:enter_rearms]
    assert_equal [], @index["RBF-046"][:enter_moves], "gli Oggetti avversari in Ritiro non sono lo spostamento di un'Entità"
    assert_equal [], @index["RBF-025"][:enter_disarms]
    assert_equal [], @index["RBF-012"][:enter_rearms], "dal Ritiro al Fronte è un'altra forma"
    assert_equal [{ max_cost: 2 }], @index["RBF-045"][:leave_returns]
    assert_equal [], @index["RBF-007"][:leave_returns], "il ritorno di chi è stato esiliato non è il ritorno vincolato"

    # Il riarmo che costa, o su un'Entità sola, esce dalla forma: ignoto.
    card = JSON.parse(File.read(File.join(DATA_DIR, "sets", "srbf-001", "cards", "rbf-046", "rbf-046.json")))
    rearm = card["faces"].flat_map { |face| face["triggers"] }.find { |t| t["id"] == "rearm" }
    caro = Marshal.load(Marshal.dump(rearm))
    caro["effect"]["details"]["noFluxCost"] = false
    refute Rubyfront::CardIndex.recognized?(caro)
    # Il ritorno vincolato senza il vincolo «senza Oggetti» non è certificato.
    card = JSON.parse(File.read(File.join(DATA_DIR, "sets", "srbf-001", "cards", "rbf-045", "rbf-045.json")))
    ritorno = card["faces"].flat_map { |face| face["triggers"] }.find { |t| t["id"] == "bound-return" }
    libero = Marshal.load(Marshal.dump(ritorno))
    libero["details"].delete("requiresNoObjectAssignedWhenLeft")
    refute Rubyfront::CardIndex.recognized?(libero)
  end

  def test_le_materie_di_eredita_perduta_alla_risoluzione
    forme = ->(id) { @index[id][:resolve_forms] }
    assert_equal [{ kind: "look", count: 4, reveal: { type: "entity", race: "human" }, reveal_to: "hand", rest_to: "deck", show_up_to: 2 }], forme.call("RBF-015")
    assert_equal [{ kind: "empower", targets: "own_entity", race: "human", power: 1, untap: true }], forme.call("RBF-016")
    assert_equal [{ kind: "move", target: { type: "entity", controller: "opponent", max_cost: 2 }, to: "ritiro", discount: nil }], forme.call("RBF-017")
    assert_equal [{ kind: "exile", target: { permanent: true, controller: "opponent" }, to: "abisso", hold: true }], forme.call("RBF-018")
    assert_equal [{ kind: "fortune", die: 20, gain: { on: [1, 6], amount: 4 }, deploy: { on: [7, 13], filter: { type: "entity", race: "human", max_cost: 2 } },
                    draw: { on: [14, 19], count: 1 }, all_on: [20, 20] }], forme.call("RBF-019")
    assert_equal [{ kind: "empower", targets: "own_entities", race: "human", counter: 1, untap: true, requires: { count: 3, race: "human" } }], forme.call("RBF-020"), "la stappata di gruppo: in Reazione, senza bloccare"
    assert_equal [{ kind: "destroy", target: { type: "entity", controller: "any" }, to: "abisso", discount: { amount: 3, if_target: "tapped" }, then_lose: nil }], forme.call("RBF-021")
    assert_equal [{ kind: "destroy", target: { type: "entity", controller: "opponent" }, to: "abisso", discount: nil, then_lose: 2 }], forme.call("RBF-038"), "«poi perdi 2 PV» è certificato dal 2026-09-10"
    assert_equal [{ kind: "drain", amount: "objects" }], forme.call("RBF-042"), "il Rubyfront/Nexus avversario perde PV pari agli Oggetti assegnati"
    assert_equal [{ kind: "search", count: 5, die: 20, bands: { "matter" => [1, 7], "object" => [8, 14], "entity" => [15, 20] }, reveal_to: "hand", if_no_reveal_top: true, then_retire: true, rest_to: "deck" }], forme.call("RBF-041"), "la ricerca col dado"
    assert_equal [{ kind: "ends", face: 0, swap: true, then_draw: 1, then_discard: 1, once: true }, { kind: "ends", face: 1, to_hand: true, other_to_retire: true, once: true }], @index["RBF-023"][:assign_forms], "gli estremi del mazzo, per faccia"
    assert_equal [{ kind: "remain", to: "ritiro", then_rearm: { other: true, to: "unarmed", free: true } }], @index["RBF-035"][:death_forms], "«quando quell'Entità muore»: in Ritiro, poi il riarmo"
    assert_equal [], @index["RBF-043"][:death_forms]
  end

  def test_le_materie_di_scissione_profonda_alla_risoluzione
    forme = ->(id) { @index[id][:resolve_forms] }
    assert_equal [{ kind: "empower", targets: "own_armed", power: 1, up_to: 2, untap: true }], forme.call("RBF-036"), "fino a 2 armate, +1 e stappate"
    assert_equal [{ kind: "weaken", target: { type: "entity", controller: "opponent", attacking: true }, amount: -1, per_armed: true }], forme.call("RBF-039"), "l'attaccante avversario, −1 per armata"
    assert_equal [{ kind: "move", target: { type: "entity", controller: "opponent", max_cost: nil }, to: "ritiro", discount: { amount: 1, if_armed_at_least: 2 } }], forme.call("RBF-044"), "in Ritiro, con 2 armate costa 1 in meno"
    assert_equal [{ kind: "exile", target: { type: "entity", controller: "opponent" }, to: "abisso", hold: true }], @index["RBF-043"][:assign_forms], "«quando assegni»: l'esilio tenuto dall'Oggetto"
    assert_equal [], @index["RBF-018"][:assign_forms], "una Materia non ha inneschi d'assegnazione"
    assert_equal [{ kind: "draw", count: 1, to_self: true }], @index["RBF-030"][:assign_forms], "«quando assegni un Oggetto a questa Entità: pesca»"
    assert_equal [{ kind: "assign_discount", amount: 1 }], @index["RBF-030"][:static_forms], "«gli Oggetti che assegni a questa Entità costano 1 in meno»"
    assert_equal [{ kind: "others_armed_power", amount: 1 }], @index["RBF-031"][:static_forms], "«le altre Entità con un Oggetto assegnato che controlli hanno +1»"
    # Un dettaglio in più rende la forma ignota, mai fraintesa.
    trigger = lambda do |id, trigger_id|
      card = JSON.parse(File.read(File.join(DATA_DIR, "sets", "srbf-001", "cards", id.downcase, "#{id.downcase}.json")))
      Marshal.load(Marshal.dump(card["faces"].flat_map { |face| face["triggers"] }.find { |t| t["id"] == trigger_id }))
    end
    frattura = trigger.call("RBF-044", "sunder")
    frattura["effect"]["details"]["fluxCostReduction"]["ifTargetState"] = "tapped"
    refute Rubyfront::CardIndex.recognized?(frattura)
    rifrazione = trigger.call("RBF-039", "refract")
    rifrazione["effect"]["amount"] = 1
    refute Rubyfront::CardIndex.recognized?(rifrazione), "un +1 non è l'indebolimento"
    prisma = trigger.call("RBF-043", "confine")
    prisma["details"] = {}
    refute Rubyfront::CardIndex.recognized?(prisma), "senza «è questo Oggetto che viene assegnato» la forma non entra"
    assert_equal [], forme.call("RBF-022"), "la permanente si innesca all'attacco, non alla risoluzione"
  end

  def test_il_nexus_di_oblivhal_e_il_suo_flip
    assert_equal({ face: 1, conditions: [{ count: 4, type: "entity", race: "human" }], discard: { count: 1, type: "entity" }, recovery: 5 }, @index["RBF-001"][:nexus])
    assert_equal [{ kind: "move", card_id: "RBF-012", from: "field", to: "abisso" }, { kind: "seal", card_id: "RBF-012" }], @index["RBF-001"][:flip_forms]
    assert_equal({ face: 1, conditions: [{ count: 3, type: "entity", race: nil, armed: true }], discard: { count: 1, type: nil }, recovery: 5 }, @index["RBF-023"][:nexus], "dal 2026-09-10: «con un Oggetto assegnato», scarta una carta")
    assert_equal %w[move seal draw], @index["RBF-023"][:flip_forms].map { |form| form[:kind] }, "ma i suoi «quando flippa» hanno la stessa forma, più la pesca"
    assert_equal({ kind: "draw", count: 1 }, @index["RBF-023"][:flip_forms].last)
    assert_nil @index["RBF-004"][:nexus]
  end

  def test_l_esploratore_pesca_quando_attacca_armato
    assert_equal [{ draw: 1, then_discard: 1, requires_object: true }], @index["RBF-026"][:attack_draws]
    assert_equal [], @index["RBF-003"][:attack_draws], "l'ascoltatore ascolta gli ingressi, non attacca"
    assert_equal [], @index["RBF-007"][:enter_returns]
    assert_equal [], @index["RBF-007"][:attack_returns]
  end

  def test_il_cercatore_guarda_quattro_carte
    assert_equal [{ count: 4, die: nil, count_base: 0, reveal: { type: "entity", race: "human" }, then_retire: false }], @index["RBF-006"][:enter_looks]
  end

  def test_lo_sguardo_col_dado_di_scissione_profonda_non_e_piu_certificato
    assert_equal [], @index["RBF-027"][:enter_looks], "dal 2026-09-10 lo sguardo col dado è del Guardiano"
    assert_equal [{ self: true }], @index["RBF-027"][:enter_rearms], "dal 2026-09-10 il riarmo su di sé all'ingresso"
    assert_equal [{ count: nil, die: 6, count_base: 0, reveal: { type: "object", race: nil }, then_retire: true, formula: "result" }], @index["RBF-025"][:enter_looks], "dal 2026-09-10 «tante carte quanto il tiro»"
  end

  def test_il_radunatore_prende_il_controllo_fino_a_fine_turno
    assert_equal [{ target: { type: "entity", controller: "opponent", max_cost: 3 }, grants: ["surge"] }], @index["RBF-009"][:enter_controls]
    assert_equal [], @index["RBF-007"][:enter_controls]
  end

  # --- il costo di schieramento (§3.1) ------------------------------------

  def test_conosce_il_costo_di_schieramento_fisso_o_a_dado
    assert_equal({ fixed: 3, die: nil }, @index["RBF-023"][:deployment])
    assert_equal({ fixed: nil, die: 6 }, @index["RBF-001"][:deployment])
    assert_nil @index["RBF-004"][:deployment], "un'Entità non si schiera"
    assert_equal({ fixed: 2, die: nil }, Rubyfront::CardIndex.deployment_of(2))
    assert_nil Rubyfront::CardIndex.deployment_of({ "die" => "dado" })
  end

  # --- Materie e abilitazioni (§7) ----------------------------------------

  def test_conosce_tipo_e_grado_delle_materie
    assert_equal({ type: "dimensional", grade: 1 }, @index["RBF-036"][:matter])
    assert_nil @index["RBF-004"][:matter], "un'Entità non è una Materia"
  end

  def test_conosce_le_abilitazioni_per_faccia
    assert_equal [[{ type: "dynamic", max_grade: 1 }]], @index["RBF-004"][:enables]
    rubino = @index["RBF-023"][:enables]
    assert_equal 2, rubino.size, "Rubyfront e Nexus: una lista per faccia"
    assert_includes rubino[0], { type: "destructive", max_grade: 1 }
    assert_includes rubino[1], { type: "destructive", max_grade: 2 }, "il Nexus abilita di più (§3.1)"
    assert_equal [[]], @index["RBF-036"][:enables], "una Materia non abilita nulla"
  end

  # --- il costo di Flusso (§3.2) ------------------------------------------

  def test_conosce_il_costo_di_flusso
    assert_equal 2, @index["RBF-004"][:flux_cost]
    assert_equal 2, @index["RBF-036"][:flux_cost], "anche le Materie si pagano"
    assert_nil @index["RBF-023"][:flux_cost], "il Rubyfront ha il costo di schieramento, non di Flusso"
  end

  # --- il comportamento delle Materie (§7.2) ------------------------------

  def test_conosce_le_materie_reattive
    assert_equal "reactive", @index["RBF-036"][:behavior]
    assert_nil @index["RBF-004"][:behavior], "un'Entità non ha comportamento di Materia"
  end

  # --- le statistiche del combattimento (§6.3) ----------------------------

  def test_conosce_la_potenza_delle_entita
    assert_equal 2, @index["RBF-004"][:power]
    assert_equal 3, @index["RBF-028"][:power]
  end

  def test_conosce_il_contrattacco_solo_di_chi_ce_l_ha
    assert_equal 1, @index["RBF-028"][:counterattack]
    assert_nil @index["RBF-004"][:counterattack], "senza la statistica non si contrattacca"
  end

  def test_chi_non_e_entita_non_ha_potenza
    assert_nil @index["RBF-013"][:power], "un Oggetto non ha Potenza"
    assert_nil @index["RBF-023"][:power], "il Rubyfront non ha Potenza: non attacca (§3.1)"
  end

  def test_un_valore_non_intero_resta_ignoto
    assert_nil Rubyfront::CardIndex.integer_stat({ "base" => 3 })
    assert_nil Rubyfront::CardIndex.integer_stat("3")
    assert_equal 3, Rubyfront::CardIndex.integer_stat(3)
  end

  # --- razza e concessioni certificate -----------------------------------

  def test_conosce_la_razza_delle_entita
    assert_equal "human", @index["RBF-009"][:race]
    assert_nil @index["RBF-013"][:race], "un Oggetto non ha razza"
  end

  def test_il_vigorscudo_concede_stasi_agli_umani
    grants = @index["RBF-013"][:grants_while_assigned]
    assert_equal 1, grants.size, "RBF-013 ha una sola concessione certificata"
    assert_equal ["stasis"], grants.first[:keywords]
    assert_equal "human", grants.first[:if_race]
  end

  def test_solo_la_forma_certificata_entra_nell_anagrafe
    # RBF-013 ha anche un secondo trigger while_assigned (+1 Potenza,
    # modify_power): non è la forma certificata e non deve comparire.
    grants = @index["RBF-013"][:grants_while_assigned]
    assert grants.all? { |grant| grant[:keywords].any? }, "solo empower con grants"
    # E chi non concede nulla ha la lista vuota, mai nil.
    assert_equal [], @index["RBF-009"][:grants_while_assigned]
  end
end
